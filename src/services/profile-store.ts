import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DEFAULT_PREFERENCES, type AppPreferences, type PersistedState, type ServerProfile } from "../core/models.ts";
import { normalizeProfile, validateProfile } from "../core/validation.ts";

const DATA_DIRECTORY = join(homedir(), ".freeshell");
const STATE_PATH = join(DATA_DIRECTORY, "state.json");

const SAMPLE_PROFILES: ServerProfile[] = [
  {
    id: "demo-production",
    name: "Production API",
    group: "生产环境",
    host: "10.20.0.12",
    port: 22,
    username: "deploy",
    authMode: "agent",
    tags: ["API", "Ubuntu"],
    favorite: true,
  },
  {
    id: "demo-database",
    name: "Primary Database",
    group: "生产环境",
    host: "10.20.0.18",
    port: 22,
    username: "ops",
    authMode: "agent",
    tags: ["PostgreSQL"],
    favorite: true,
  },
  {
    id: "demo-staging",
    name: "Staging",
    group: "测试环境",
    host: "staging.example.com",
    port: 22,
    username: "developer",
    authMode: "agent",
    tags: ["Docker"],
    favorite: false,
  },
];

function initialState(): PersistedState {
  return { version: 1, profiles: SAMPLE_PROFILES, preferences: { ...DEFAULT_PREFERENCES } };
}

export class ProfileStore {
  private state: PersistedState;

  constructor() {
    this.state = this.load();
  }

  get profiles(): ServerProfile[] {
    return this.state.profiles.slice();
  }

  get preferences() {
    return { ...this.state.preferences };
  }

  find(id: string): ServerProfile | undefined {
    return this.state.profiles.find((profile) => profile.id === id);
  }

  saveProfile(input: ServerProfile): void {
    const profile = normalizeProfile(input);
    const validation = validateProfile(profile);
    if (!validation.valid) throw new Error(Object.values(validation.errors)[0]);

    const index = this.state.profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) this.state.profiles[index] = profile;
    else this.state.profiles.push(profile);
    this.persist();
  }

  removeProfile(id: string): void {
    this.state.profiles = this.state.profiles.filter((profile) => profile.id !== id);
    this.persist();
  }

  markConnected(id: string): void {
    const profile = this.find(id);
    if (!profile) return;
    profile.lastConnectedAt = new Date().toISOString();
    this.persist();
  }

  updatePreferences(patch: Partial<AppPreferences>): void {
    this.state.preferences = { ...this.state.preferences, ...patch };
    this.persist();
  }

  private load(): PersistedState {
    if (!existsSync(STATE_PATH)) return initialState();
    try {
      const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as PersistedState;
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) return initialState();
      return {
        version: 1,
        profiles: parsed.profiles.map(normalizeProfile),
        preferences: { ...DEFAULT_PREFERENCES, ...parsed.preferences },
      };
    } catch (error) {
      console.error("Unable to load FreeShell state:", error);
      return initialState();
    }
  }

  private persist(): void {
    mkdirSync(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
    const temporaryPath = `${STATE_PATH}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, STATE_PATH);
  }
}
