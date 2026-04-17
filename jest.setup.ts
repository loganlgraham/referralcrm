import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill for TextEncoder/TextDecoder (required by supertest v7)
global.TextEncoder = TextEncoder as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

// Provide a dummy MongoDB URI so modules that transitively import
// `src/lib/mongoose` don't crash at load time in unit tests.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/referralcrm-test';
