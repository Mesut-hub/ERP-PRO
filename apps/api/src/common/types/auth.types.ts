export type JwtAccessPayload = {
  sub: string; // userId
  email: string;
  permissions: string[];
  locale?: string | null;
};