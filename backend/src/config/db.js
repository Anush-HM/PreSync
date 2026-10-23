import mongoose from 'mongoose';
import Room from '../models/Room.js';

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set — copy .env.example to .env and fill it in.');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('MongoDB connected');
  await syncRoomIndexes();
}

// Databases created before room codes became reusable still carry a
// unique `code_1` index over every room, active or not. syncIndexes()
// drops indexes the schema no longer declares and builds the partial
// one in its place. Scoped to Room so indexes on other collections are
// left alone.
async function syncRoomIndexes() {
  const dropped = await Room.syncIndexes();
  if (dropped.length) console.log(`Dropped stale room indexes: ${dropped.join(', ')}`);
}