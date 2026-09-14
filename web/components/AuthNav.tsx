"use client";
import { SignInButton, SignedOut } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/** Signed-out header slot in clerk mode: opens Clerk's sign-in modal (there are no auth pages). */
export function AuthNav({ signInLabel }: { signInLabel: string }) {
  return (
    <SignedOut>
      <SignInButton mode="modal"><Button size="sm" variant="outline">{signInLabel}</Button></SignInButton>
    </SignedOut>
  );
}
