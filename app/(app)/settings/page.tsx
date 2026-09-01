import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { UsagePanel } from "@/components/settings/UsagePanel";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <ProfileSettings />
      <Link href="/settings/wearables" className="inline-block text-sm text-emerald-400 hover:underline">
        Wearables →
      </Link>
      <UsagePanel />
      <AccountSettings />
    </div>
  );
}
