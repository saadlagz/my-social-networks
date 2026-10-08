import validate from '../utils/validate.mjs';
import {
  badRequest, conflict, forbidden, notFound
} from '../utils/http-error.mjs';
import { paginate } from '../utils/query.mjs';
import {
  PUBLIC_USER, findById, includesUser, isOrganizer, loadEvent, sameUser
} from '../utils/access.mjs';
import rules from '../validators/carpool.mjs';

const Carpools = class Carpools {
  constructor(app, { models, auth }) {
    this.app = app;
    this.models = models;
    this.Carpool = models.Carpool;
    this.auth = auth;

    this.run();
  }

  checkEnabled(event) {
    if (!event.settings.carpooling) {
      throw conflict('le covoiturage n\'est pas activé pour cet événement (settings.carpooling)');
    }
  }

  checkDeparture(event, departureTime) {
    if (departureTime >= event.end_date) throw badRequest(['departure_time doit être avant la fin de l\'événement']);
  }

  async loadCarpool(id, user) {
    const carpool = await findById(this.Carpool, id, 'Carpool');
    const event = await loadEvent(this.models, carpool.event, user, 'participant');

    this.checkEnabled(event);

    return { carpool, event };
  }

  async present(carpool) {
    await carpool.populate([
      { path: 'driver', select: PUBLIC_USER },
      { path: 'passengers', select: PUBLIC_USER }
    ]);

    return carpool;
  }

  getCarpools() {
    this.app.get('/events/:id/carpools', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');

      this.checkEnabled(event);

      res.status(200).json(await paginate(this.Carpool, { event: event._id }, req.query, {
        sort: { departure_time: 1 },
        populate: [{ path: 'driver', select: PUBLIC_USER }, { path: 'passengers', select: PUBLIC_USER }]
      }));
    });
  }

  createCarpool() {
    this.app.post('/events/:id/carpools', this.auth.required, async (req, res) => {
      const event = await loadEvent(this.models, req.params.id, req.user, 'participant');

      this.checkEnabled(event);

      const { errors, value } = validate(req.body, rules.carpool);

      if (errors.length > 0) throw badRequest(errors);

      this.checkDeparture(event, value.departure_time);

      if (await this.Carpool.exists({ event: event._id, driver: req.user._id })) {
        throw conflict('vous proposez déjà un trajet pour cet événement');
      }

      const carpool = await this.Carpool.create({ ...value, event: event._id, driver: req.user._id });

      res.status(201).json(await this.present(carpool));
    });
  }

  getCarpoolById() {
    this.app.get('/carpools/:id', this.auth.required, async (req, res) => {
      const { carpool } = await this.loadCarpool(req.params.id, req.user);

      res.status(200).json(await this.present(carpool));
    });
  }

  updateCarpool() {
    this.app.patch('/carpools/:id', this.auth.required, async (req, res) => {
      const { carpool, event } = await this.loadCarpool(req.params.id, req.user);

      if (!sameUser(carpool.driver, req.user)) throw forbidden('seul le conducteur peut modifier son trajet');

      const { errors, value } = validate(req.body, rules.carpool, { partial: true });

      if (errors.length > 0) throw badRequest(errors);
      if (Object.keys(value).length === 0) throw badRequest(['aucun champ modifiable envoyé']);
      if (value.departure_time) this.checkDeparture(event, value.departure_time);
      if (value.seats !== undefined && value.seats < carpool.passengers.length) {
        throw conflict(`${carpool.passengers.length} passagers sont déjà inscrits : seats ne peut pas être inférieur`);
      }

      carpool.set(value);
      await carpool.save();

      res.status(200).json(await this.present(carpool));
    });
  }

  deleteCarpool() {
    this.app.delete('/carpools/:id', this.auth.required, async (req, res) => {
      const { carpool, event } = await this.loadCarpool(req.params.id, req.user);

      if (!sameUser(carpool.driver, req.user) && !isOrganizer(event, req.user)) {
        throw forbidden('seul le conducteur ou un organisateur peut supprimer ce trajet');
      }

      await carpool.deleteOne();

      res.status(200).json(carpool);
    });
  }

  // un participant réserve une place dans la voiture
  joinCarpool() {
    this.app.post('/carpools/:id/passengers', this.auth.required, async (req, res) => {
      const { carpool } = await this.loadCarpool(req.params.id, req.user);
      const me = req.user._id;

      if (sameUser(carpool.driver, me)) throw conflict('le conducteur ne peut pas être passager de son trajet');
      if (includesUser(carpool.passengers, me)) throw conflict('vous êtes déjà passager de ce trajet');

      // atomique : la place n'est prise que s'il en reste une au moment de l'écriture
      const updated = await this.Carpool.findOneAndUpdate(
        { _id: carpool._id, passengers: { $ne: me }, $expr: { $lt: [{ $size: '$passengers' }, '$seats'] } },
        { $push: { passengers: me } },
        { new: true }
      );

      if (!updated) throw conflict('il n\'y a plus de place dans cette voiture');

      res.status(200).json(await this.present(updated));
    });
  }

  leaveCarpool() {
    this.app.delete('/carpools/:id/passengers/:userId', this.auth.required, async (req, res) => {
      const { carpool } = await this.loadCarpool(req.params.id, req.user);
      const { userId } = req.params;

      // un passager peut se désinscrire, le conducteur peut retirer un passager
      if (!sameUser(userId, req.user) && !sameUser(carpool.driver, req.user)) {
        throw forbidden('seul le passager ou le conducteur peut annuler cette réservation');
      }
      if (!includesUser(carpool.passengers, userId)) throw notFound('Passenger');

      carpool.passengers.pull(userId);
      await carpool.save();

      res.status(200).json(await this.present(carpool));
    });
  }

  run() {
    this.getCarpools();
    this.createCarpool();
    this.getCarpoolById();
    this.updateCarpool();
    this.deleteCarpool();
    this.joinCarpool();
    this.leaveCarpool();
  }
};

export default Carpools;
