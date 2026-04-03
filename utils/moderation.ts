const BLOCKED_WORDS = [
  'ass', 'asshole', 'bastard', 'bitch', 'cock', 'cunt', 'damn', 'dick',
  'fuck', 'fucker', 'fucking', 'goddam', 'goddamn', 'hell', 'hoe',
  'motherfucker', 'nigga', 'nigger', 'penis', 'piss', 'porn', 'pussy',
  'rape', 'rapist', 'retard', 'retarded', 'shit', 'slut', 'whore',
  'nazi', 'hitler', 'kkk', 'faggot', 'fag', 'dyke', 'tranny',
  'spic', 'chink', 'wetback', 'kike', 'cracker',
];

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 15;

const BLOCKED_PATTERNS = [
  /n[i1!]+[gq]+[aeur]+/i,
  /f+[u\*]+c+k+/i,
  /s+h+[i1!]+t+/i,
  /b[i1!]+t+c+h+/i,
  /a+s+s+h+o+l+e+/i,
];

export function isUsernameOffensive(username: string): boolean {
  const lower = username.toLowerCase().replace(/[_\-.\s]/g, '');

  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word)) {
      return true;
    }
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  return false;
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (username.length < USERNAME_MIN_LENGTH) {
    return { valid: false, error: `At least ${USERNAME_MIN_LENGTH} characters` };
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return { valid: false, error: `Max ${USERNAME_MAX_LENGTH} characters` };
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Only letters, numbers, and underscores' };
  }
  if (isUsernameOffensive(username)) {
    return { valid: false, error: 'This username is not allowed' };
  }
  return { valid: true };
}
