import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Badge, Button, Card, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/_app/price-lists/')({
  component: PriceListsIndex,
});

interface PriceList {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  is_default: boolean;
  item_count: number;
}

function PriceListsIndex() {
  const { data, isLoading } = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => api.get<{ items: PriceList[] }>('/price-lists'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Price lists</h1>
        <Link to="/price-lists/new">
          <Button>+ New price list</Button>
        </Link>
      </div>

      <Card>
        {isLoading ? (
          <Spinner label="Loading price lists" />
        ) : data?.items.length === 0 ? (
          <div className="text-sm text-slate-500">
            No price lists yet. Create the first one — assign it to customer to charge them a
            different rate from the default list.
          </div>
        ) : (
          <div className="w-full text-sm">
            <div className="grid grid-cols-[1fr_110px_110px_110px_80px] gap-x-3 border-b border-slate-200 pb-2 text-xs uppercase text-slate-500">
              <div>Name</div>
              <div>Effective from</div>
              <div>Effective to</div>
              <div>Items</div>
              <div />
            </div>
            {data?.items.map((pl) => (
              <a
                key={pl.id}
                href={`/price-lists/${pl.id}`}
                className="grid grid-cols-[1fr_110px_110px_110px_80px] items-center gap-x-3 border-b border-slate-200 py-2 text-slate-800 no-underline transition hover:bg-slate-100/70"
              >
                <div className="flex items-center gap-2">
                  <span>{pl.name}</span>
                  {pl.is_default && <Badge tone="blue">default</Badge>}
                </div>
                <div className="text-xs text-slate-600">
                  {pl.effective_from?.slice(0, 10)}
                </div>
                <div className="text-xs text-slate-600">
                  {pl.effective_to ? pl.effective_to.slice(0, 10) : '—'}
                </div>
                <div className="text-slate-700">{pl.item_count}</div>
                <div className="text-right text-amber-400">Open →</div>
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
