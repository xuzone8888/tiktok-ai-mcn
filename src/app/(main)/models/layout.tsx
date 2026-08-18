import { AppIntlProvider } from "@/components/providers/app-intl-provider";

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return <AppIntlProvider>{children}</AppIntlProvider>;
}
