import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
