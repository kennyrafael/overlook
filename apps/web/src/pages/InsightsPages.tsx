import FilterBar from '../components/FilterBar';
import ClaudeInsights from '../insights/ClaudeInsights';
import GitInsights from '../insights/GitInsights';
import { useInsightScope } from '../insights/useInsightScope';

export function GitPage() {
  const { ids } = useInsightScope();
  return (
    <div className="flex flex-column gap-3">
      <FilterBar />
      <GitInsights projectIds={ids} />
    </div>
  );
}

export function ClaudePage() {
  const { ids } = useInsightScope();
  return (
    <div className="flex flex-column gap-3">
      <FilterBar />
      <ClaudeInsights projectIds={ids} />
    </div>
  );
}
