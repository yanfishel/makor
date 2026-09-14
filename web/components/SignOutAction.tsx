"use client";
import { SignOutButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function SignOutAction({ label }: { label: string }) {
  return <SignOutButton redirectUrl="/"><Button variant="outline">{label}</Button></SignOutButton>;
}
