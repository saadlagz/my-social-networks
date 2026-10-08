export default {
  type: {
    name: { type: 'string', required: true, max: 100 },
    amount: { type: 'amount', required: true, min: 0, max: 100000 },
    quantity: { type: 'integer', required: true, min: 1, max: 1000000 }
  },
  // achat ouvert aux personnes extérieures : pas de compte, juste leurs informations
  purchase: {
    firstname: { type: 'name', required: true },
    lastname: { type: 'name', required: true },
    email: { type: 'email', required: true },
    address: {
      type: 'object',
      required: true,
      rules: {
        street: { type: 'string', required: true, max: 200 },
        zip_code: { type: 'postalCode', required: true },
        city: { type: 'string', required: true, max: 100 },
        country: { type: 'string', required: true, max: 100 }
      }
    }
  }
};
