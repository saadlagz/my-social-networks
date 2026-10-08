import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // quantité limitée de billets
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isInteger, message: 'quantity doit être un entier' }
  },
  // compteur incrémenté de façon atomique à chaque achat
  sold: {
    type: Number,
    default: 0,
    min: 0
  }
}, options('ticket_types', { toJSON: { virtuals: true }, id: false }));

Schema.virtual('remaining').get(function remaining() {
  return this.quantity - this.sold;
});

Schema.index({ event: 1, name: 1 }, { unique: true });

export default Schema;
