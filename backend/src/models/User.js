import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Editors/presenters are the only account type — presenter is just an
// editor currently broadcasting, not a separate role. Viewers never get
// a User document; they're tracked entirely via Viewer.viewerId.
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true }
  },
  { timestamps: true }
);

userSchema.methods.verifyPassword = function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10);
};

export default mongoose.model('User', userSchema);