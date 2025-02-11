const getItems = require('./getItems');
const batchWriteItems = require('./batchWriteItems');

const transformItems = async (ddb, tableName, transformer, isDryRun) => {
  let lastEvalKey;
  let transformedItemsKeys = [];

  let scannedAllItems = false;

  while (!scannedAllItems) {
    const { Items, LastEvaluatedKey } = await getItems(ddb, lastEvalKey, tableName);
    lastEvalKey = LastEvaluatedKey;

    const updatedItems = Items.map(transformer);

    if (!isDryRun) {
      await batchWriteItems(ddb, tableName, updatedItems);
      transformedItemsKeys = transformedItemsKeys.concat(updatedItems.map((item) => `${item.PK}-${item.SK}`));
    } else {
      console.info(updatedItems, 'updatedItems');
    }

    scannedAllItems = !lastEvalKey;
  }

  return { transformed: transformedItemsKeys.length };
};

module.exports = transformItems;
