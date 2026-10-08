import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  departure_place: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300
  },
  departure_time: {
    type: Date,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  seats: {
    type: Number,
    required: true,
    min: 1,
    max: 8
  },
  // temps maximum d'écart accepté sur le trajet, en minutes
  max_detour_minutes: {
    type: Number,
    required: true,
    min: 0
  },
  passengers: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    validate: {
      validator(list) {
        return list.length <= this.seats;
      },
      message: 'plus de passagers que de places disponibles'
    }
  }
}, options('carpools', { toJSON: { virtuals: true }, id: false }));

Schema.virtual('seats_left').get(function seatsLeft() {
  return this.seats - this.passengers.length;
});

// un conducteur ne propose qu'un trajet par événement
Schema.index({ event: 1, driver: 1 }, { unique: true });

export default Schema;
