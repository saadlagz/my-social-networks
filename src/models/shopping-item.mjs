import mongoose from 'mongoose';

import options from './options.mjs';

const Schema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  // nom normalisé (minuscules, sans accents) : "Chips" et "chips " sont la même chose
  name_key: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  arrival_time: {
    type: Date,
    required: true
  }
}, options('shopping_items'));

Schema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.name_key;
    return ret;
  }
});

// chaque chose apportée est unique par événement
Schema.index({ event: 1, name_key: 1 }, { unique: true });

export default Schema;
