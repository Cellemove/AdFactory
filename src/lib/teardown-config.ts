export type TeardownConfiguration = {
  baseUrl: string;
  token: string;
};

export type TeardownConfigurationStatus = {
  configuration: TeardownConfiguration | null;
  issue: string | null;
};

type TeardownEnvironment = {
  NODE_ENV?: string;
  TEARDOWN_API_BASE_URL?: string;
  TEARDOWN_INTERNAL_TOKEN?: string;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function resolveTeardownConfiguration(
  environment: TeardownEnvironment = process.env,
): TeardownConfigurationStatus {
  const rawBaseUrl = environment.TEARDOWN_API_BASE_URL?.trim();
  const token = environment.TEARDOWN_INTERNAL_TOKEN?.trim();

  if (!rawBaseUrl && !token) return { configuration: null, issue: null };
  if (!rawBaseUrl || !token) {
    return {
      configuration: null,
      issue: "TEARDOWN_API_BASE_URL and TEARDOWN_INTERNAL_TOKEN must both be set.",
    };
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    return { configuration: null, issue: "TEARDOWN_API_BASE_URL is not a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { configuration: null, issue: "TEARDOWN_API_BASE_URL must use HTTP or HTTPS." };
  }
  if (environment.NODE_ENV === "production" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return {
      configuration: null,
      issue: "TEARDOWN_API_BASE_URL points to localhost, which is unreachable from the deployed app. Use the public Teardown API URL.",
    };
  }

  return {
    configuration: {
      baseUrl: rawBaseUrl.replace(/\/$/, ""),
      token,
    },
    issue: null,
  };
}
