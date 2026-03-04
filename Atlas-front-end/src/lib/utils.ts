import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Severity } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getSeverityClassNames(severity: Severity) {
  switch (severity) {
    case 'Critical':
      return {
        text: 'text-red-500',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
        badge: 'bg-red-500/20 text-red-400 border-red-500/30'
      };
    case 'High':
      return {
        text: 'text-orange-500',
        bg: 'bg-orange-500/10',
        border: 'border-orange-500/20',
        badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30'
      };
    case 'Medium':
      return {
        text: 'text-yellow-500',
        bg: 'bg-yellow-500/10',
        border: 'border-yellow-500/20',
        badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      };
    case 'Low':
      return {
        text: 'text-blue-500',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
        badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      };
    case 'Healthy':
       return {
        text: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      };
    default:
      return {
        text: 'text-gray-500',
        bg: 'bg-gray-500/10',
        border: 'border-gray-500/20',
        badge: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
      };
  }
}
