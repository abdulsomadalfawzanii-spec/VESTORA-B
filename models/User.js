import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: { type: String, trim: true, maxlength: 32, default: '' },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'customer', 'vendor', 'delivery'], default: 'customer' },
    isActive: { type: Boolean, default: true },
    favorites: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
    },
  },
  { timestamps: true },
);

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('passwordHash')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  }
});

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

export default mongoose.models.User ?? mongoose.model('User', userSchema);
