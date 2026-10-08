export default {
  carpool: {
    departure_place: { type: 'string', required: true, max: 300 },
    departure_time: { type: 'date', required: true },
    price: { type: 'amount', required: true, min: 0, max: 1000 },
    seats: { type: 'integer', required: true, min: 1, max: 8 },
    max_detour_minutes: { type: 'integer', required: true, min: 0, max: 180 }
  }
};
