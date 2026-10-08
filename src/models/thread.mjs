import mongoose from 'mongoose';

import options from './options.mjs';

// un fil de discussion est lié à 1 groupe OU à 1 événement, jamais aux deux
const Schema = new mongoose.Schema({
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    default: null
  }
}, options('threads'));

Schema.pre('validate', function checkTarget() {
  if (!!this.group === !!this.event) {
    this.invalidate('group', 'un fil de discussion doit être lié à un groupe ou à un événement, mais pas aux deux');
  }
});

// un seul fil par groupe et par événement
Schema.index({ group: 1 }, { unique: true, partialFilterExpression: { group: { $type: 'objectId' } } });
Schema.index({ event: 1 }, { unique: true, partialFilterExpression: { event: { $type: 'objectId' } } });

export default Schema;
