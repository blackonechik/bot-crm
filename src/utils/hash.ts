import bcrypt from 'bcryptjs';

export async function hashPassword(input: string): Promise<string> {
  return bcrypt.hash(input, 10);
}

export async function comparePassword(input: string, hash: string): Promise<boolean> {
  return bcrypt.compare(input, hash);
}
