import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/index.ts';

export default function WorldOverviewPage() {
  const { wid } = useParams<{ wid: string }>();
  const navigate = useNavigate();
  const { treeNodes } = useStore();

  useEffect(() => {
    if (treeNodes.length > 0 && wid) {
      navigate(`/worlds/${wid}/articles/${treeNodes[0].id}`, { replace: true });
    }
  }, [treeNodes, wid, navigate]);

  return <div className="p-8 text-sm text-gray-400">Loading…</div>;
}
