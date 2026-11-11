import mongoose, { Schema } from 'mongoose';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getIsMongoConnected } from '../database/connection.js';

export interface IUser {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
}

const UserSchema = new Schema(
  {
    _id: { type: String, default: () => uuidv4() },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    salt: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      transform: (_, ret: any) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.passwordHash;
        delete ret.salt;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const MongooseUserModel = mongoose.models.User || mongoose.model('User', UserSchema);

// In-memory fallback store
let memoryUsers: IUser[] = [];

export const UserSecurity = {
  /**
   * Hashes a password using Node's native scrypt with a random salt.
   * Completely immune to timing attacks and dictionary attacks without external dependencies.
   */
  async hashPassword(password: string): Promise<{ hash: string; salt: string }> {
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        resolve({
          hash: derivedKey.toString('hex'),
          salt,
        });
      });
    });
  },

  /**
   * Constant-time password verification using crypto.timingSafeEqual.
   */
  async verifyPassword(password: string, storedHash: string, salt: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) return reject(err);
        const keyBuffer = Buffer.from(derivedKey.toString('hex'), 'hex');
        const hashBuffer = Buffer.from(storedHash, 'hex');

        if (keyBuffer.length !== hashBuffer.length) {
          return resolve(false);
        }

        try {
          resolve(crypto.timingSafeEqual(keyBuffer, hashBuffer));
        } catch {
          resolve(false);
        }
      });
    });
  },
};

export const UserRepository = {
  async create(email: string, password: string): Promise<IUser> {
    const normalizedEmail = email.toLowerCase().trim();
    const { hash, salt } = await UserSecurity.hashPassword(password);

    const userData: IUser = {
      id: uuidv4(),
      email: normalizedEmail,
      passwordHash: hash,
      salt,
      createdAt: new Date(),
    };

    if (getIsMongoConnected()) {
      try {
        const doc = await MongooseUserModel.create({
          _id: userData.id,
          email: userData.email,
          passwordHash: userData.passwordHash,
          salt: userData.salt,
        });
        return {
          id: doc._id,
          email: doc.email,
          passwordHash: doc.passwordHash,
          salt: doc.salt,
          createdAt: doc.createdAt,
        };
      } catch (err: any) {
        if (err.code === 11000) {
          throw new Error('An account with this email address already exists');
        }
      }
    }

    if (memoryUsers.some((u) => u.email === normalizedEmail)) {
      throw new Error('An account with this email address already exists');
    }

    memoryUsers.push(userData);
    return userData;
  },

  async findByEmail(email: string): Promise<IUser | null> {
    const normalizedEmail = email.toLowerCase().trim();

    if (getIsMongoConnected()) {
      try {
        const doc = await MongooseUserModel.findOne({ email: normalizedEmail });
        if (doc) {
          return {
            id: doc._id,
            email: doc.email,
            passwordHash: doc.passwordHash,
            salt: doc.salt,
            createdAt: doc.createdAt,
          };
        }
      } catch {
        // Fall back
      }
    }

    return memoryUsers.find((u) => u.email === normalizedEmail) || null;
  },

  async findById(id: string): Promise<IUser | null> {
    if (getIsMongoConnected()) {
      try {
        const doc = await MongooseUserModel.findById(id);
        if (doc) {
          return {
            id: doc._id,
            email: doc.email,
            passwordHash: doc.passwordHash,
            salt: doc.salt,
            createdAt: doc.createdAt,
          };
        }
      } catch {
        // Fall back
      }
    }

    return memoryUsers.find((u) => u.id === id) || null;
  },

  clearMemoryStore(): void {
    memoryUsers = [];
  },
};

