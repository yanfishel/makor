import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Hebrew } from "next/font/google";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
const hebrew = IBM_Plex_Sans_Hebrew({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600"], variable: "--font-plex-hebrew", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

/** Class list for <html>: exposes the three font variables; globals.css picks sans by lang. */
export const fontClasses = `${sans.variable} ${hebrew.variable} ${mono.variable}`;
