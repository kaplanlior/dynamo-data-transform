const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const getTableKeySchema = require('../../utils/getTableKeySchema');

const MIGRATIONS_KEY_ID = 'Migrations';

const getDataMigrationKey = async (table) => {
  const keySchema = await getTableKeySchema(table);
  const dataMigrationKey = keySchema.reduce((acc, val) => ({
    ...acc,
    [val.AttributeName]: MIGRATIONS_KEY_ID,
  }), {});
  return dataMigrationKey;
};

const getMigrationRecord = async (ddb, table) => {
  const dataMigrationKey = await getDataMigrationKey(table);
  const getCommand = new GetCommand({
    TableName: table,
    Key: dataMigrationKey,
  });

  try {
    const { Item } = await ddb.send(getCommand);

    if (!Item) console.info(`No migration record for table ${table}`);
    return Item || dataMigrationKey;
  } catch (error) {
    console.error(`Could not get migration record for table ${table}`, error);
    return dataMigrationKey;
  }
};

const hasMigrationRun = async (ddb, sequence, table) => {
  const migrationRecord = await getMigrationRecord(ddb, table);

  const isSequenceExecutedInSomeBatch = migrationRecord && Object
    .values(migrationRecord.Batches)
    .reduce((acc, val) => acc.concat(val), []).includes(sequence);

  return isSequenceExecutedInSomeBatch;
};

const syncMigrationRecord = async (ddb, batchNumber, sequence, table, transformed) => {
  const migrationRecord = await getMigrationRecord(ddb, table);
  const existingBatches = migrationRecord ? migrationRecord.Batches : {};
  const batchToUpdate = existingBatches[batchNumber] || [];
  const migrationsRunHistory = migrationRecord ? migrationRecord.MigrationsRunHistory : {};
  batchToUpdate.push(sequence);
  const updatedItem = {
    ...migrationRecord,
    Batches: {
      ...existingBatches,
      [batchNumber]: batchToUpdate,
    },
    MigrationsRunHistory: {
      ...migrationsRunHistory,
      [new Date().toISOString()]: {
        batchNumber,
        migrationNumber: sequence,
        executedCommand: 'up',
        transformed,
      },
    },
  };

  const putCommand = new PutCommand({
    TableName: table,
    Item: updatedItem,
  });

  await ddb.send(putCommand);
};

const getMigrationsRunHistory = async (ddb, table) => {
  const migrationRecord = await getMigrationRecord(ddb, table);
  return migrationRecord ? migrationRecord.MigrationsRunHistory : {};
};

const removeSequenceFromBatch = async (ddb, batchNumber, sequence, table) => {
  const migrationRecord = await getMigrationRecord(ddb, table);
  if (!migrationRecord) {
    return;
  }
  const sequences = migrationRecord.Batches[`${batchNumber}`];
  const index = sequences.indexOf(sequence);
  const migrationsRunHistory = migrationRecord ? migrationRecord.MigrationsRunHistory : {};

  let batches;

  if (index > -1) {
    sequences.splice(index, 1);
  }
  if (!sequences.length) {
    const currentBatches = migrationRecord.Batches;
    delete currentBatches[`${batchNumber}`];
    batches = currentBatches;
  } else {
    batches = {
      ...migrationRecord.Batches,
      [batchNumber]: sequences,
    };
  }

  const updatedItem = {
    ...migrationRecord,
    Batches: batches,
    MigrationsRunHistory: {
      ...migrationsRunHistory,
      [new Date().toISOString()]: {
        batchNumber,
        migrationNumber: sequence,
        executedCommand: 'down',
      },
    },
  };

  const putCommand = new PutCommand({
    TableName: table,
    Item: updatedItem,
  });

  return ddb.send(putCommand);
};

const getLatestBatch = async (ddb, table) => {
  try {
    const migrationRecord = await getMigrationRecord(ddb, table);

    if (!migrationRecord) {
      console.info('No latest batch');
      return;
    }
    const batches = Object.keys(migrationRecord.Batches)
      .map((batchNumber) => parseInt(batchNumber, 10))
      .sort()
      .reverse();
    const latestBatchNumber = batches[0];
    if (!latestBatchNumber) {
      console.info('No latestBatchNumber');
      return;
    }
    return {
      batchNumber: latestBatchNumber,
      sequences: migrationRecord.Batches[latestBatchNumber],
    };
  } catch (error) {
    console.error(
      `An error has occured while trying to get latest batch for table ${table}`,
      error,
    );
  }
};

const removeBatch = async (ddb, batch, table) => {
  const migrationRecord = await getMigrationRecord(ddb, table);

  if (!migrationRecord) return;

  const currentBatches = migrationRecord.Batches;
  delete currentBatches[`${batch}`];
  const updatedItem = {
    ...migrationRecord,
    Batches: currentBatches,
  };

  const putCommand = new PutCommand({
    TableName: table,
    Item: updatedItem,
  });

  await ddb.send(putCommand);
};

module.exports = {
  getLatestBatch,
  getMigrationRecord,
  removeBatch,
  removeSequenceFromBatch,
  syncMigrationRecord,
  hasMigrationRun,
  getMigrationsRunHistory,
};
