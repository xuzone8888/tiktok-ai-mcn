import { AppIntlProvider } from "@/components/providers/app-intl-provider";

export default function CharacterCreateLayout({ children }: { children: React.ReactNode }) {
  return <AppIntlProvider>{children}</AppIntlProvider>;
}
