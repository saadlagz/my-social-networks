export default {
  item: {
    name: { type: 'string', required: true, max: 100 },
    quantity: { type: 'integer', required: true, min: 1, max: 1000 },
    arrival_time: { type: 'date', required: true }
  }
};
