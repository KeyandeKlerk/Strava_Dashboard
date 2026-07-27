import { LiveSessionPanel } from "@/components/gym/LiveSessionPanel";
import { GymHistoryList } from "@/components/gym/GymHistoryList";

// No data fetch here on purpose — see gym/layout.tsx's header comment. All
// dynamic content is client-fetched via GymOfflineProvider so this shell
// stays static/precacheable for offline cold-launch reachability.
export default function GymPage() {
  return (
    <div>
      <LiveSessionPanel />

      <div className="mt-6">
        <h2 className="text-sm font-medium">Recent sessions</h2>
        <GymHistoryList />
      </div>
    </div>
  );
}
