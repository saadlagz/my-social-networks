// options communes à toutes les collections : created_at / updated_at gérés par mongoose
export default (collection, extra = {}) => ({
  collection,
  versionKey: false,
  minimize: false,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  ...extra
});
