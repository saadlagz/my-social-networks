export default {
  album: {
    name: { type: 'string', required: true, max: 100 },
    description: { type: 'string', max: 1000, nullable: true }
  },
  photo: {
    url: { type: 'url', required: true },
    caption: { type: 'string', max: 500, nullable: true }
  },
  photoUpdate: {
    caption: { type: 'string', max: 500, nullable: true }
  },
  comment: {
    content: { type: 'string', required: true, max: 1000 }
  }
};
