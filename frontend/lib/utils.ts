import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The name to greet someone by: the first word, skipping a leading title such as "Dr." or "Mrs.". */
export function firstName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  const titled = words.length > 1 && /^(dr|mr|mrs|ms|miss|prof|shri|smt)\.?$/i.test(words[0]);
  return titled ? words[1] : words[0];
}
