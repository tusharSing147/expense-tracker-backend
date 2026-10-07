import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(process.cwd(), '.env.test') });
