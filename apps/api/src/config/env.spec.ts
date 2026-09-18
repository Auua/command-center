import { isLearningConfigured, isSchedulerConfigured, validateEnv } from './env';

const VALID_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'anon-key',
  MONGODB_CONNECT: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/',
  SUPABASE_SECRET_KEY: 'service-role-key',
  TICK_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  VAPID_PUBLIC_KEY: 'vapid-public-key',
  VAPID_PRIVATE_KEY: 'vapid-private-key',
  VAPID_SUBJECT: 'mailto:owner@example.com',
};

describe('validateEnv', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const env = validateEnv(VALID_ENV);

    expect(env.PORT).toBe(3001);
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.MONGODB_CONNECT).toBe(VALID_ENV.MONGODB_CONNECT);
  });

  it('coerces PORT from string', () => {
    const env = validateEnv({ ...VALID_ENV, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it.each([
    'mongodb://localhost:27017/command_center',
    'mongodb+srv://u:p@host.mongodb.net/db?retryWrites=true',
  ])('accepts MONGODB_CONNECT %s', (uri) => {
    expect(() => validateEnv({ ...VALID_ENV, MONGODB_CONNECT: uri })).not.toThrow();
  });

  it('rejects a missing MONGODB_CONNECT with a pointer to the schema', () => {
    const { MONGODB_CONNECT: _omitted, ...withoutMongo } = VALID_ENV;
    expect(() => validateEnv(withoutMongo)).toThrow(/MONGODB_CONNECT/);
    expect(() => validateEnv(withoutMongo)).toThrow(/env\.ts/);
  });

  it('rejects a MONGODB_CONNECT that is not a mongodb URI', () => {
    expect(() => validateEnv({ ...VALID_ENV, MONGODB_CONNECT: 'postgres://nope' })).toThrow(
      /mongodb:\/\/ or mongodb\+srv:\/\//,
    );
  });

  it('rejects an invalid SUPABASE_URL', () => {
    expect(() => validateEnv({ ...VALID_ENV, SUPABASE_URL: 'not-a-url' })).toThrow(/SUPABASE_URL/);
  });

  it.each(['SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const)(
    'rejects a partial Phase 2 group with %s missing (all-or-nothing)',
    (key) => {
      const { [key]: _omitted, ...without } = VALID_ENV;
      expect(() => validateEnv(without)).toThrow(new RegExp(key));
      expect(() => validateEnv(without)).toThrow(/all-or-nothing/);
    },
  );

  it('accepts the Phase 2 group entirely unset (scheduler unconfigured)', () => {
    const {
      SUPABASE_SECRET_KEY: _a,
      TICK_SECRET: _b,
      VAPID_PUBLIC_KEY: _c,
      VAPID_PRIVATE_KEY: _d,
      VAPID_SUBJECT: _e,
      ...base
    } = VALID_ENV;
    const env = validateEnv(base);
    expect(isSchedulerConfigured(env)).toBe(false);
    expect(isSchedulerConfigured(validateEnv(VALID_ENV))).toBe(true);
  });

  it('treats empty strings in the Phase 2 group as unset', () => {
    const env = validateEnv({
      ...VALID_ENV,
      SUPABASE_SECRET_KEY: '',
      TICK_SECRET: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: '',
    });
    expect(isSchedulerConfigured(env)).toBe(false);
  });

  it('accepts the learning vault pair unset, set, or blank — never half set', () => {
    expect(isLearningConfigured(validateEnv(VALID_ENV))).toBe(false);
    expect(
      isLearningConfigured(
        validateEnv({
          ...VALID_ENV,
          GITHUB_LEARNING_REPO: 'auua/learning-center',
          GITHUB_LEARNING_TOKEN: 'github_pat_x',
        }),
      ),
    ).toBe(true);
    expect(
      isLearningConfigured(
        validateEnv({ ...VALID_ENV, GITHUB_LEARNING_REPO: '', GITHUB_LEARNING_TOKEN: '' }),
      ),
    ).toBe(false);
    expect(() =>
      validateEnv({ ...VALID_ENV, GITHUB_LEARNING_REPO: 'auua/learning-center' }),
    ).toThrow(/GITHUB_LEARNING_TOKEN/);
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        GITHUB_LEARNING_REPO: 'not-a-repo',
        GITHUB_LEARNING_TOKEN: 'x',
      }),
    ).toThrow(/owner\/name/);
  });

  it('rejects a short TICK_SECRET', () => {
    expect(() => validateEnv({ ...VALID_ENV, TICK_SECRET: 'short' })).toThrow(/TICK_SECRET/);
  });

  it('rejects a VAPID_SUBJECT that is not mailto: or https:', () => {
    expect(() => validateEnv({ ...VALID_ENV, VAPID_SUBJECT: 'owner@example.com' })).toThrow(
      /VAPID_SUBJECT/,
    );
    expect(() =>
      validateEnv({ ...VALID_ENV, VAPID_SUBJECT: 'https://example.com/contact' }),
    ).not.toThrow();
  });
});
