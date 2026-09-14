"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface ThemeLabels { light: string; dark: string; system: string; toggle: string }

export function ThemeToggle({ labels }: { labels: ThemeLabels }) {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={labels.toggle}>
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}><Sun />{labels.light}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}><Moon />{labels.dark}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}><Monitor />{labels.system}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
