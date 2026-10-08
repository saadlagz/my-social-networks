export default {
  message: {
    content: { type: 'string', required: true, max: 2000 },
    reply_to: { type: 'id', nullable: true }
  },
  update: {
    content: { type: 'string', required: true, max: 2000 }
  }
};
