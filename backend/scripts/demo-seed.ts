/**
 * TRVL-135: creates the demo data the Milestone 1 Swagger walkthrough starts from: an airline with its
 * moderator and two flights, a hotel with its moderator and two rooms, and one traveller.
 *
 * It goes through the same services as the API (validation, time zones, hashing), as the moderators
 * who own the records, so nothing it writes could not be written through Swagger. Every record has a
 * stable name, code or email: an existing one is left exactly as it is, so running it again creates
 * nothing and never overwrites a password someone changed. Records the seed did not create are never
 * touched (an email that belongs to a different kind of account stops the seed).
 */
import type { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  ProviderType,
  Role,
  type AuthUser,
} from '../src/common/auth/auth.types';
import {
  REFERENCE_SERVICE,
  type ReferenceService,
} from '../src/common/contracts';
import { PasswordService } from '../src/common/security/password.service';
import { Airline, Flight } from '../src/modules/flights';
import { AirlinesService } from '../src/modules/flights/airlines.service';
import { FlightsService } from '../src/modules/flights/flights.service';
import { Hotel, HotelsService, Room } from '../src/modules/hotels';
import { RoomsService } from '../src/modules/hotels/rooms.service';
import { AccountStatus, User, UsersService } from '../src/modules/users';
import {
  DEMO_ACCOUNTS,
  DEMO_AIRLINE,
  DEMO_CABIN,
  DEMO_FLIGHTS,
  DEMO_HOTEL,
  DEMO_ROOMS,
} from './demo-data';

export interface DemoSeedResult {
  /** What this run created or completed; empty when everything already existed. */
  created: string[];
  /** Ids of the demo records, created or reused, for Swagger. Never a password. */
  airlineId: string;
  hotelId: string;
  flights: { flightNumber: string; id: string; cabinId: string }[];
  rooms: { number: string; id: string }[];
}

interface Account {
  name: string;
  email: string;
}

export async function seedDemo(
  app: INestApplicationContext,
  password: string,
): Promise<DemoSeedResult> {
  const get = <T>(token: string | symbol | (new (...args: never[]) => T)) =>
    app.get<T>(token, { strict: false });
  const model = <T>(name: string) => get<Model<T>>(getModelToken(name));

  const reference = get<ReferenceService>(REFERENCE_SERVICE);
  if (
    !(await reference.getAirport('CAI')) ||
    !(await reference.getAirport('LHR')) ||
    !(await reference.getCity(DEMO_HOTEL.cityId))
  ) {
    throw new Error(
      'The reference data is missing (airports CAI and LHR, city cairo). Run `npm run seed` first.',
    );
  }

  const users = model<User>(User.name);
  const airlineModel = model<Airline>(Airline.name);
  const flightModel = model<Flight>(Flight.name);
  const hotelModel = model<Hotel>(Hotel.name);
  const roomModel = model<Room>(Room.name);
  const airlines = get(AirlinesService);
  const flights = get(FlightsService);
  const hotels = get(HotelsService);
  const rooms = get(RoomsService);
  const passwords = get(PasswordService);
  const travellers = get(UsersService);
  const created: string[] = [];
  const flightIds: DemoSeedResult['flights'] = [];
  const roomIds: DemoSeedResult['rooms'] = [];
  const done = (what: string) => {
    if (!created.includes(what)) created.push(what);
  };

  /** The provider a demo moderator is assigned to, or null when that moderator does not exist yet. */
  const moderatorOf = async (
    account: Account,
    type: ProviderType,
  ): Promise<{ providerId: Types.ObjectId } | null> => {
    const email = account.email.toLowerCase();
    const existing = await users.findOne({ email }).lean();
    if (!existing) return null;
    if (existing.assignedProvider?.type !== type) {
      throw new Error(
        `${email} already belongs to a ${existing.role} account that is not the demo ${type.toLowerCase()} moderator; ` +
          'rename or remove it, then run the demo seed again',
      );
    }
    return { providerId: existing.assignedProvider.providerId };
  };

  const ensureAccount = async (
    account: Account,
    role: Role,
    provider?: { type: ProviderType; id: Types.ObjectId },
  ): Promise<Types.ObjectId> => {
    const email = account.email.toLowerCase();
    const existing = await users.findOne({ email }).lean();
    if (existing) {
      const sameProvider =
        provider === undefined ||
        existing.assignedProvider?.providerId.equals(provider.id) === true;
      if (existing.role !== role || !sameProvider) {
        throw new Error(
          `${email} already belongs to a ${existing.role} account that is not the demo ${role}; ` +
            'rename or remove it, then run the demo seed again',
        );
      }
      return existing._id;
    }
    const passwordHash = await passwords.hash(password);
    if (role === Role.User) {
      const traveller = await travellers.createTraveller({
        name: account.name,
        email,
        passwordHash,
        termsAcceptedAt: new Date(),
      });
      done('traveller');
      return new Types.ObjectId(traveller.id);
    }
    // Not through ModeratorsService: that one forces a password change on first login (ACC-13), and
    // the demo moderators must be able to start working straight away.
    const moderator = await users.create({
      name: account.name,
      email,
      passwordHash,
      role,
      status: AccountStatus.Active,
      mustChangePassword: false,
      ...(provider && {
        assignedProvider: { type: provider.type, providerId: provider.id },
      }),
    });
    done(
      role === Role.AirlineModerator ? 'airline moderator' : 'hotel moderator',
    );
    return moderator._id;
  };

  // --- Airline, its moderator, policies, flights and cabins ---
  // The demo moderator's email is the marker no API call can change (moderators rename their airline,
  // even its code). Once that moderator exists, the airline is the one it is assigned to.
  const airlineMod = await moderatorOf(
    DEMO_ACCOUNTS.airlineModerator,
    ProviderType.Airline,
  );
  let airline = airlineMod
    ? await airlineModel.findById(airlineMod.providerId).lean()
    : await airlineModel.findOne({ code: DEMO_AIRLINE.code }).lean();
  if (!airline) {
    await airlines.create({ name: DEMO_AIRLINE.name, code: DEMO_AIRLINE.code });
    airline = await airlineModel.findOne({ code: DEMO_AIRLINE.code }).lean();
    done('airline');
  } else if (!airlineMod && airline.name !== DEMO_AIRLINE.name) {
    // No demo moderator yet: an airline that merely uses code DM is not ours to attach one or policies to.
    throw new Error(
      `The airline with code ${DEMO_AIRLINE.code} is not the demo airline (its name is "${airline.name}", expected "${DEMO_AIRLINE.name}"); ` +
        'rename or remove it, then run the demo seed again',
    );
  }
  if (!airline) throw new Error('The demo airline could not be created');
  const airlineId = airline._id;
  const airlineModeratorId = await ensureAccount(
    DEMO_ACCOUNTS.airlineModerator,
    Role.AirlineModerator,
    { type: ProviderType.Airline, id: airlineId },
  );
  const airlineUser: AuthUser = {
    id: airlineModeratorId.toHexString(),
    role: Role.AirlineModerator,
    assignedProvider: {
      type: ProviderType.Airline,
      providerId: airlineId.toHexString(),
    },
  };
  if (!airline.policy?.extraBaggage) {
    await airlines.setBaggagePolicy(
      airlineUser,
      airlineId.toHexString(),
      DEMO_AIRLINE.baggage,
    );
    done('airline policies');
  }
  if (!airline.policy?.cancellationTiers?.length) {
    await airlines.setCancellationPolicy(airlineUser, airlineId.toHexString(), {
      tiers: DEMO_AIRLINE.cancellationTiers.map((t) => ({ ...t })),
    });
    done('airline policies');
  }
  for (const plan of DEMO_FLIGHTS) {
    let flight = await flightModel
      .findOne({
        airlineId,
        flightNumber: plan.flightNumber,
        departureLocalDate: plan.departureLocal.slice(0, 10),
      })
      .lean();
    if (!flight) {
      const made = await flights.create(airlineUser, { ...plan });
      flight = await flightModel.findById(made.id).lean();
      done('flights');
    }
    if (flight && !flight.cabins.some((c) => c.class === DEMO_CABIN.class)) {
      await flights.addCabin(airlineUser, flight._id.toHexString(), {
        ...DEMO_CABIN,
      });
      done('flights');
    }
    const cabin = (await flightModel.findById(flight?._id).lean())?.cabins.find(
      (c) => c.class === DEMO_CABIN.class,
    );
    if (!flight || !cabin) throw new Error(`${plan.flightNumber} has no cabin`);
    flightIds.push({
      flightNumber: plan.flightNumber,
      id: flight._id.toHexString(),
      cabinId: String((cabin as { _id?: unknown })._id),
    });
  }

  // --- Hotel, its moderator, policies, rooms and availability ---
  const hotelFilter = { name: DEMO_HOTEL.name, cityId: DEMO_HOTEL.cityId };
  const hotelMod = await moderatorOf(
    DEMO_ACCOUNTS.hotelModerator,
    ProviderType.Hotel,
  );
  let hotel = hotelMod
    ? await hotelModel.findById(hotelMod.providerId).lean()
    : await hotelModel.findOne(hotelFilter).lean();
  if (!hotel) {
    await hotels.create({
      name: DEMO_HOTEL.name,
      address: DEMO_HOTEL.address,
      cityId: DEMO_HOTEL.cityId,
      description: DEMO_HOTEL.description,
      starClass: DEMO_HOTEL.starClass,
      amenities: [...DEMO_HOTEL.amenities],
    });
    hotel = await hotelModel.findOne(hotelFilter).lean();
    done('hotel');
  } else if (!hotelMod && hotel.address !== DEMO_HOTEL.address) {
    throw new Error(
      `The hotel named "${DEMO_HOTEL.name}" in ${DEMO_HOTEL.cityId} is not the demo hotel (a different address); ` +
        'rename or remove it, then run the demo seed again',
    );
  }
  if (!hotel) throw new Error('The demo hotel could not be created');
  const hotelId = hotel._id;
  const hotelModeratorId = await ensureAccount(
    DEMO_ACCOUNTS.hotelModerator,
    Role.HotelModerator,
    { type: ProviderType.Hotel, id: hotelId },
  );
  const hotelUser: AuthUser = {
    id: hotelModeratorId.toHexString(),
    role: Role.HotelModerator,
    assignedProvider: {
      type: ProviderType.Hotel,
      providerId: hotelId.toHexString(),
    },
  };
  // Check-in/out times and cancellation tiers (HTL-09, HTL-10) have no endpoint yet, so they are set
  // on the document, and only while the hotel has none.
  const policies = await hotelModel.updateOne(
    { _id: hotelId, checkInTime: { $exists: false } },
    {
      $set: {
        checkInTime: DEMO_HOTEL.checkInTime,
        checkOutTime: DEMO_HOTEL.checkOutTime,
        cancellationTiers: DEMO_HOTEL.cancellationTiers.map((t) => ({ ...t })),
      },
    },
  );
  if (policies.modifiedCount > 0) done('hotel policies');
  for (const plan of DEMO_ROOMS) {
    let room = await roomModel.findOne({ hotelId, number: plan.number }).lean();
    if (!room) {
      const made = await rooms.create(hotelUser, hotelId.toHexString(), {
        ...plan,
      });
      room = await roomModel.findById(made.id).lean();
      done('rooms');
    }
    if (room && room.availability.length === 0) {
      await rooms.addAvailability(
        hotelUser,
        hotelId.toHexString(),
        room._id.toHexString(),
        { ranges: [{ ...DEMO_HOTEL.availability }] },
      );
      done('rooms');
    }
    if (room) roomIds.push({ number: plan.number, id: room._id.toHexString() });
  }

  await ensureAccount(DEMO_ACCOUNTS.traveller, Role.User);

  return {
    created,
    airlineId: airlineId.toHexString(),
    hotelId: hotelId.toHexString(),
    flights: flightIds,
    rooms: roomIds,
  };
}
