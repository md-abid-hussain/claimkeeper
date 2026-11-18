/**
 * Fake credentials for testing claimkeeper's secret detector. None of these are real.
 * They are assembled at runtime so secret scanners (GitGuardian, GitHub push protection)
 * have no literal to match in the source, while the detector still sees the full values.
 */
const j = (...parts: string[]) => parts.join("");

export const FAKE = {
  /** OpenAI/Anthropic-style key */
  skKey: j("sk", "-", "abcdefghijklmnopqrstuvwxyz", "123456"),
  /** the same kind of key inside a config assignment */
  skAssignment: j("API_", "KEY=", "sk", "-", "abcdefghijklmnopqrstuvwxyz", "0123"),
  /** project-scoped key, as found in a .env line */
  skProjectLine: j("OPENAI API KEY ", "sk", "-proj-", "abcdefghijklmnopqrstuvwxyz", "123456"),
  /** AWS access key id */
  awsKeyId: j("AK", "IA", "ABCDEFGH", "IJKLMNOP"),
  /** key assignment in an env file */
  envAssignment: j("ELEVENLABS_", "API_", "KEY=", "abcd1234", "efgh5678"),
  /** hex token after a "token:" label */
  hexToken: j("tok", "en: ", "9f8a7b6c5d4e3f2a", "1b0c9d8e7f6a5b4c3d2e1f0a"),
  /** password after a "password:" label */
  password: j("pass", "word: ", "hunter2", "hunter2"),
  /** bearer token in an HTTP header */
  bearer: j("Bear", "er ", "abcdefghijklmnop", "1234"),
};
