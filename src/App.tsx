import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  MoreVertical,
  Pencil,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  Plus,
  ChevronRight,
  ChevronDown,
  GripVertical,
  History,
  Info
} from 'lucide-react';

const defaultDims = ['Регион', 'Город', 'Район', 'Улица', 'Дом'];
const uid = () => Math.random().toString(36).slice(2, 10);
const cloneDeep = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type TreeNode = { id: string; name: string; children: TreeNode[] };
type Forest = TreeNode[];
type Pos = { level: number; y: number };
type NodeOption = { id: string; label: string };
type DragState = { draggingId: string; x: number; y: number };
type OverlayState = { nodeId: string; rect: { left: number; top: number; width: number; height: number } };
type ChangeLogItem = { id: string; at: number; summary: string };

const makeNode = (name: string, children: TreeNode[] = []): TreeNode => ({ id: uid(), name, children });
const uniqueName = (base: string, taken: Set<string>) => {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
};

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

const initialForest: Forest = [
  makeNode('Центральный', [
    makeNode('Москва', [
      makeNode('Химки', [makeNode('Желтая', [makeNode('22')]), makeNode('Красная')]),
      makeNode('Садовое кольцо')
    ]),
    makeNode('Нижний Новгород'),
    makeNode('Тверь')
  ]),
  makeNode('Северо-западный')
];

const findNodeAndParent = (forest: Forest, id: string) => {
  let parent: TreeNode | null = null;
  let found: TreeNode | null = null;
  const dfs = (nodes: TreeNode[], p: TreeNode | null): boolean => {
    for (const n of nodes) {
      if (n.id === id) {
        parent = p;
        found = n;
        return true;
      }
      if (n.children?.length) if (dfs(n.children, n)) return true;
    }
    return false;
  };
  dfs(forest, null);
  return { parent, node: found };
};

const buildVisibleForest = (forest: Forest, collapsedIds: Set<string>): Forest => {
  const mapNode = (n: TreeNode): TreeNode => {
    if (collapsedIds.has(n.id)) return { ...n, children: [] };
    return { ...n, children: (n.children || []).map(mapNode) };
  };
  return forest.map(mapNode);
};

const flattenForest = (forest: Forest) => {
  const out: TreeNode[] = [];
  const dfs = (nodes: TreeNode[]) => {
    nodes.forEach((n) => {
      out.push(n);
      if (n.children?.length) dfs(n.children);
    });
  };
  dfs(forest);
  return out;
};

const layoutForest = (forest: Forest) => {
  const positions = new Map<string, Pos>();
  let leafY = 0;
  const walk = (node: TreeNode, level: number): number => {
    if (!node.children || node.children.length === 0) {
      const y = leafY;
      leafY += 1;
      positions.set(node.id, { level, y });
      return y;
    }
    const childYs = node.children.map((c) => walk(c, level + 1));
    const y = childYs.reduce((a, b) => a + b, 0) / Math.max(childYs.length, 1);
    positions.set(node.id, { level, y });
    return y;
  };
  forest.forEach((n) => walk(n, 0));
  return positions;
};

const maxLevel = (forest: Forest) => {
  let m = 0;
  const dfs = (nodes: TreeNode[], level: number) => {
    m = Math.max(m, level);
    nodes.forEach((n) => n.children?.length && dfs(n.children, level + 1));
  };
  dfs(forest, 0);
  return m;
};

const getPathToNode = (forest: Forest, id: string) => {
  const path: TreeNode[] = [];
  const dfs = (nodes: TreeNode[]): boolean => {
    for (const n of nodes) {
      path.push(n);
      if (n.id === id) return true;
      if (n.children?.length && dfs(n.children)) return true;
      path.pop();
    }
    return false;
  };
  dfs(forest);
  return path;
};

const isDescendant = (forest: Forest, ancestorId: string, maybeDescendantId: string) => {
  const { node: anc } = findNodeAndParent(forest, ancestorId);
  if (!anc) return false;
  let found = false;
  const dfs = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.id === maybeDescendantId) {
        found = true;
        return;
      }
      if (n.children?.length) dfs(n.children);
      if (found) return;
    }
  };
  dfs(anc.children || []);
  return found;
};

const detachNode = (forest: Forest, nodeId: string): { forest: Forest; detached: TreeNode | null } => {
  const updated = cloneDeep(forest);
  let detached: TreeNode | null = null;
  const dfs = (nodes: TreeNode[]): boolean => {
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      if (n.id === nodeId) {
        detached = n;
        nodes.splice(i, 1);
        return true;
      }
      if (n.children?.length) if (dfs(n.children)) return true;
    }
    return false;
  };
  dfs(updated);
  return { forest: updated, detached };
};

const moveNodeAsChild = (forest: Forest, draggingId: string, targetId: string) => {
  if (draggingId === targetId) return { forest, moved: false };
  if (isDescendant(forest, draggingId, targetId)) return { forest, moved: false };
  const { forest: without, detached } = detachNode(forest, draggingId);
  if (!detached) return { forest, moved: false };
  const { node: target } = findNodeAndParent(without, targetId);
  if (!target) return { forest, moved: false };
  target.children = target.children || [];
  target.children.push(detached);
  return { forest: without, moved: true };
};

const listNodeOptions = (forest: Forest, dims: string[], pos: Map<string, Pos>, excludeId: string) => {
  const out: NodeOption[] = [];
  const dfs = (nodes: TreeNode[]) => {
    nodes.forEach((n) => {
      if (n.id !== excludeId) {
        const level = pos.get(n.id)?.level;
        const dim = typeof level === 'number' ? dims[level] : '';
        const path = getPathToNode(forest, n.id)
          .map((p) => p.name)
          .join(' → ');
        out.push({ id: n.id, label: `${dim ? `${dim}: ` : ''}${n.name} — ${path}` });
      }
      if (n.children?.length) dfs(n.children);
    });
  };
  dfs(forest);
  return out;
};

const runSanityTests = () => {
  {
    const q = 'a+b';
    const re = new RegExp(escapeRegExp(q), 'i');
    if (!re.test('A+B')) throw new Error('regex escaper failed: +');
    const q2 = '(a)[b]\\c?^$';
    const re2 = new RegExp(escapeRegExp(q2));
    if (!re2.test(q2)) throw new Error('regex escaper failed: specials');
  }
  {
    const f: Forest = [makeNode('R', [makeNode('C')]), makeNode('R2')];
    const moved = moveNodeAsChild(f, f[1].id, f[0].id);
    if (!moved.moved) throw new Error('moveNodeAsChild failed');
  }
};

function NodeActionsOverlay({
  overlay,
  onAdd,
  onDelete,
  onRequestClose,
  onHoldOpen
}: {
  overlay: OverlayState | null;
  onAdd: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onRequestClose: () => void;
  onHoldOpen: () => void;
}) {
  if (!overlay) return null;
  const gap = 12;
  const left = overlay.rect.left + overlay.rect.width + gap;
  const top = overlay.rect.top + overlay.rect.height / 2;
  const bridgeLeft = overlay.rect.left + overlay.rect.width;
  const bridgeTop = overlay.rect.top;
  return (
    <>
      <div
        className="fixed z-[9998]"
        style={{ left: bridgeLeft, top: bridgeTop, width: gap, height: overlay.rect.height }}
        onMouseEnter={onHoldOpen}
        onMouseLeave={onRequestClose}
      />
      <div
        className="fixed z-[9999]"
        style={{ left, top, transform: 'translateY(-50%)' }}
        onMouseEnter={onHoldOpen}
        onMouseLeave={onRequestClose}
      >
        <div className="flex items-center gap-2">
          <button
            className="p-1.5 rounded bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onHoldOpen();
              onAdd(overlay.nodeId);
            }}
          >
            <Plus size={16} />
          </button>
          <button
            className="p-1.5 rounded bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              onHoldOpen();
              onDelete(overlay.nodeId);
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

export default function App() {
  useMemo(() => {
    runSanityTests();
    return null;
  }, []);

  const [committedAt, setCommittedAt] = useState<number>(Date.now());
  const [committedGroupName, setCommittedGroupName] = useState('Регион');
  const [activeTab, setActiveTab] = useState('Регион');
  const [groupName, setGroupName] = useState('Регион');
  const [dims, setDims] = useState(defaultDims);
  const [forest, setForest] = useState<Forest>(initialForest);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [rulesCollapsed, setRulesCollapsed] = useState(false);
  const [docsCollapsed, setDocsCollapsed] = useState(false);
  const [paymentsCollapsed, setPaymentsCollapsed] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState(groupName);
  const groupInputRef = useRef<HTMLInputElement | null>(null);
  const [editingDimIndex, setEditingDimIndex] = useState<number | null>(null);
  const [dimDraft, setDimDraft] = useState('');
  const dimInputRef = useRef<HTMLInputElement | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState('');
  const nodeInputRef = useRef<HTMLInputElement | null>(null);
  const [changeLog, setChangeLog] = useState<ChangeLogItem[]>([]);
  const [justApplied, setJustApplied] = useState(false);
  const applyTimer = useRef<number | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; nodeId: string | null }>({ open: false, nodeId: null });
  const [reassignTargetId, setReassignTargetId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const overlayHideTimer = useRef<number | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const addChange = (summary: string) => setChangeLog((prev) => [...prev, { id: uid(), at: Date.now(), summary }].slice(-80));
  const hasPendingChanges = changeLog.length > 0;
  const applyChanges = () => {
    setCommittedAt(Date.now());
    setCommittedGroupName(groupName);
    setChangeLog([]);
    setJustApplied(true);
    if (applyTimer.current) window.clearTimeout(applyTimer.current);
    applyTimer.current = window.setTimeout(() => setJustApplied(false), 1600);
  };

  const clearOverlayTimer = () => {
    if (overlayHideTimer.current) {
      window.clearTimeout(overlayHideTimer.current);
      overlayHideTimer.current = null;
    }
  };
  const scheduleHideOverlay = () => {
    clearOverlayTimer();
    overlayHideTimer.current = window.setTimeout(() => {
      setOverlay(null);
      overlayHideTimer.current = null;
    }, 280);
  };

  useEffect(() => {
    dropTargetRef.current = dropTargetId;
  }, [dropTargetId]);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const visibleForest = useMemo(() => buildVisibleForest(forest, collapsed), [forest, collapsed]);
  const flatVisibleNodes = useMemo(() => flattenForest(visibleForest), [visibleForest]);
  const pos = useMemo(() => layoutForest(visibleForest), [visibleForest]);
  const depth = useMemo(() => maxLevel(visibleForest), [visibleForest]);
  const posFull = useMemo(() => layoutForest(forest), [forest]);

  const COL_W = 220;
  const ROW_H = 56;
  const NODE_W = 190;
  const NODE_H = 36;
  const LEFT_PAD = 12;
  const TOP_PAD = 44;
  const tabs = useMemo(() => ['Кредитная линия', groupName, 'Тип договора'], [groupName]);

  const startRenameGroup = () => {
    setEditingGroup(true);
    setGroupDraft(groupName);
    setTimeout(() => groupInputRef.current?.focus?.(), 0);
  };
  const commitRenameGroup = () => {
    const next = (groupDraft || '').trim();
    if (!next) return;
    const prev = groupName;
    setGroupName(next);
    if (activeTab === groupName) setActiveTab(next);
    setEditingGroup(false);
    addChange(`Переименована группа аналитик: "${prev}" → "${next}"`);
  };
  const cancelRenameGroup = () => {
    setGroupDraft(groupName);
    setEditingGroup(false);
  };

  const startRenameDim = (index: number) => {
    setEditingDimIndex(index);
    setDimDraft(dims[index] || '');
    setTimeout(() => dimInputRef.current?.focus?.(), 0);
  };
  const commitRenameDim = () => {
    if (editingDimIndex === null) return;
    const next = (dimDraft || '').trim();
    if (!next) return;
    const prev = dims[editingDimIndex];
    const updated = [...dims];
    updated[editingDimIndex] = next;
    setDims(updated);
    setEditingDimIndex(null);
    setDimDraft('');
    addChange(`Переименован уровень: "${prev}" → "${next}"`);
  };
  const cancelRenameDim = () => {
    setEditingDimIndex(null);
    setDimDraft('');
  };
  const addDimLeft = (index: number) => {
    const name = uniqueName('Новый уровень', new Set(dims));
    const updated = [...dims];
    updated.splice(index, 0, name);
    setDims(updated);
    setEditingDimIndex(index);
    setDimDraft(name);
    setTimeout(() => dimInputRef.current?.focus?.(), 0);
    addChange(`Добавлен уровень слева от "${dims[index]}": "${name}"`);
  };
  const addDimRight = (index: number) => {
    const name = uniqueName('Новый уровень', new Set(dims));
    const updated = [...dims];
    updated.splice(index + 1, 0, name);
    setDims(updated);
    setEditingDimIndex(index + 1);
    setDimDraft(name);
    setTimeout(() => dimInputRef.current?.focus?.(), 0);
    addChange(`Добавлен уровень справа от "${dims[index]}": "${name}"`);
  };

  const toggleCollapsed = (nodeId: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
    return next;
  });
  const expandNode = (nodeId: string) => setCollapsed((prev) => {
    if (!prev.has(nodeId)) return prev;
    const next = new Set(prev);
    next.delete(nodeId);
    return next;
  });

  const collapseToLevel = (levelIndex: number) => {
    const ids = new Set<string>();
    const dfs = (nodes: TreeNode[]) => nodes.forEach((n) => {
      const lvl = posFull.get(n.id)?.level ?? 0;
      if (lvl >= levelIndex) ids.add(n.id);
      if (n.children?.length) dfs(n.children);
    });
    dfs(forest);
    setCollapsed(ids);
  };
  const expandFromLevel = (levelIndex: number) => setCollapsed((prev) => {
    const next = new Set(prev);
    const dfs = (nodes: TreeNode[]) => nodes.forEach((n) => {
      const lvl = posFull.get(n.id)?.level ?? 0;
      if (lvl >= levelIndex) next.delete(n.id);
      if (n.children?.length) dfs(n.children);
    });
    dfs(forest);
    return next;
  });

  const addChildRight = (parentId: string) => {
    const updated = cloneDeep(forest);
    const { node } = findNodeAndParent(updated, parentId);
    if (!node) return;
    const childName = uniqueName('Новый элемент', new Set((node.children || []).map((c) => c.name)));
    const child = makeNode(childName);
    node.children.push(child);
    setForest(updated);
    expandNode(parentId);
    setSelectedId(child.id);
    setPanelOpen(true);
    setEditingNodeId(child.id);
    setNodeDraft(childName);
    setTimeout(() => nodeInputRef.current?.focus?.(), 0);
    const parentName = findNodeAndParent(forest, parentId).node?.name || '';
    addChange(`Добавлен дочерний элемент "${childName}" к "${parentName}"`);
  };
  const addRegion = () => {
    const updated = cloneDeep(forest);
    const name = uniqueName('Новый регион', new Set(updated.map((n) => n.name)));
    const root = makeNode(name);
    updated.push(root);
    setForest(updated);
    setSelectedId(root.id);
    setPanelOpen(true);
    setEditingNodeId(root.id);
    setNodeDraft(name);
    setTimeout(() => nodeInputRef.current?.focus?.(), 0);
    addChange(`Добавлен регион: "${name}"`);
  };

  const requestDeleteNode = (nodeId: string) => {
    setDeleteDialog({ open: true, nodeId });
    setReassignTargetId(null);
  };
  const closeDeleteDialog = () => {
    setDeleteDialog({ open: false, nodeId: null });
    setReassignTargetId(null);
  };
  const deleteNodeAndChildren = (nodeId: string) => {
    const nodeName = findNodeAndParent(forest, nodeId).node?.name || '';
    const updated = cloneDeep(forest);
    const { parent } = findNodeAndParent(updated, nodeId);
    if (!parent) {
      const idx = updated.findIndex((n) => n.id === nodeId);
      if (idx >= 0) updated.splice(idx, 1);
    } else parent.children = (parent.children || []).filter((c) => c.id !== nodeId);
    setForest(updated);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    if (selectedId === nodeId) {
      setSelectedId(null);
      setPanelOpen(false);
    }
    if (editingNodeId === nodeId) {
      setEditingNodeId(null);
      setNodeDraft('');
    }
    if (overlay?.nodeId === nodeId) setOverlay(null);
    addChange(`Удалён элемент "${nodeName}" (вместе с дочерними)`);
  };

  const confirmDeleteWithChildren = () => {
    if (!deleteDialog.nodeId) return;
    deleteNodeAndChildren(deleteDialog.nodeId);
    closeDeleteDialog();
  };
  const confirmReassignChildren = () => {
    if (!deleteDialog.nodeId || !reassignTargetId) return;
    if (reassignTargetId === deleteDialog.nodeId || isDescendant(forest, deleteDialog.nodeId, reassignTargetId)) return;
    const nodeName = findNodeAndParent(forest, deleteDialog.nodeId).node?.name || '';
    const targetName = findNodeAndParent(forest, reassignTargetId).node?.name || '';
    const updated = cloneDeep(forest);
    const { node } = findNodeAndParent(updated, deleteDialog.nodeId);
    const { node: target } = findNodeAndParent(updated, reassignTargetId);
    if (!node || !target) return;
    target.children.push(...(node.children || []));
    const { parent } = findNodeAndParent(updated, deleteDialog.nodeId);
    if (!parent) {
      const idx = updated.findIndex((n) => n.id === deleteDialog.nodeId);
      if (idx >= 0) updated.splice(idx, 1);
    } else parent.children = (parent.children || []).filter((c) => c.id !== deleteDialog.nodeId);
    setForest(updated);
    closeDeleteDialog();
    addChange(`Удалён элемент "${nodeName}" с перевесом детей на "${targetName}"`);
  };

  const commitRenameNode = () => {
    const next = (nodeDraft || '').trim();
    if (!next || !editingNodeId) return;
    const prevName = findNodeAndParent(forest, editingNodeId).node?.name || '';
    const updated = cloneDeep(forest);
    const { node } = findNodeAndParent(updated, editingNodeId);
    if (!node) return;
    node.name = next;
    setForest(updated);
    setEditingNodeId(null);
    setNodeDraft('');
    addChange(`Переименован элемент: "${prevName}" → "${next}"`);
  };
  const cancelRenameNode = () => {
    setEditingNodeId(null);
    setNodeDraft('');
  };

  const hitTestTarget = (clientX: number, clientY: number, draggingId: string) => {
    let hit: string | null = null;
    for (const [id, el] of Object.entries(nodeRefs.current)) {
      if (!el || id === draggingId) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) hit = id;
    }
    return hit;
  };
  const startDrag = (nodeId: string, e: React.PointerEvent) => {
    if (editingNodeId || deleteDialog.open) return;
    clearOverlayTimer();
    setOverlay(null);
    e.preventDefault();
    e.stopPropagation();
    setPanelOpen(false);
    setDrag({ draggingId: nodeId, x: e.clientX, y: e.clientY });
    setDropTargetId(null);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const finishDrag = (finalDropTargetId: string | null, draggingId: string) => {
    if (!finalDropTargetId) {
      setDrag(null);
      setDropTargetId(null);
      return;
    }
    const fromName = findNodeAndParent(forest, draggingId).node?.name || '';
    const toName = findNodeAndParent(forest, finalDropTargetId).node?.name || '';
    const res = moveNodeAsChild(forest, draggingId, finalDropTargetId);
    if (res.moved) {
      setForest(res.forest);
      expandNode(finalDropTargetId);
      setSelectedId(draggingId);
      addChange(`Перемещён элемент "${fromName}" → в дочерние к "${toName}"`);
    }
    setDrag(null);
    setDropTargetId(null);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag) return;
      setDrag((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev));
      const t = hitTestTarget(ev.clientX, ev.clientY, currentDrag.draggingId);
      if (t && isDescendant(forest, currentDrag.draggingId, t)) setDropTargetId(null);
      else setDropTargetId(t);
    };
    const onUp = () => {
      const currentDrag = dragRef.current;
      if (!currentDrag) return;
      finishDrag(dropTargetRef.current, currentDrag.draggingId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [drag, forest]);

  const edges = useMemo(() => {
    const out: Array<[string, string]> = [];
    const dfs = (nodes: TreeNode[]) => nodes.forEach((n) => {
      (n.children || []).forEach((c) => out.push([n.id, c.id]));
      if (n.children?.length) dfs(n.children);
    });
    dfs(visibleForest);
    return out;
  }, [visibleForest]);

  const canvasW = Math.max(depth + 1, dims.length) * 220 + 240;
  const maxY = Math.max(...Array.from(pos.values()).map((pp) => pp.y), 0);
  const canvasH = 44 + (maxY + 1) * 56 + 140;
  const selectedNode = selectedId ? findNodeAndParent(forest, selectedId).node : null;
  const selectedLevel = selectedId ? posFull.get(selectedId)?.level : undefined;
  const selectedDim = typeof selectedLevel === 'number' ? dims[selectedLevel] || '' : '';
  const selectedPath = selectedId ? getPathToNode(forest, selectedId) : [];
  const deleteNode = deleteDialog.nodeId ? findNodeAndParent(forest, deleteDialog.nodeId).node : null;
  const deleteHasChildren = (deleteNode?.children || []).length > 0;

  const reassignOptions = useMemo(() => {
    if (!deleteDialog.nodeId) return [] as NodeOption[];
    return listNodeOptions(forest, dims, posFull, deleteDialog.nodeId).filter((o) => !isDescendant(forest, deleteDialog.nodeId, o.id));
  }, [deleteDialog.nodeId, forest, dims, posFull]);

  const showOverlayForNode = (nodeId: string) => {
    clearOverlayTimer();
    const el = nodeRefs.current[nodeId];
    if (!el) return;
    const r = el.getBoundingClientRect();
    setOverlay({ nodeId, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
  };

  useEffect(() => {
    if (!overlay) return;
    const refresh = () => {
      const el = nodeRefs.current[overlay.nodeId];
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOverlay({ nodeId: overlay.nodeId, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
    };
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    return () => {
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
    };
  }, [overlay]);

  const queryRe = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    try {
      return new RegExp(escapeRegExp(q), 'i');
    } catch {
      return null;
    }
  }, [query]);

  const isMatch = (name: string) => (queryRe ? queryRe.test(name) : false);

  const renderDimHeader = (dim: string, index: number) => {
    const isEditing = editingDimIndex === index;
    return (
      <div key={`${dim}-${index}`} className="flex items-center gap-2 text-xs text-gray-500">
        {!isEditing ? (
          <>
            <button
              onClick={() => {
                const anyCollapsed = Array.from(collapsed).some((id) => (posFull.get(id)?.level ?? 0) >= index);
                if (anyCollapsed) expandFromLevel(index);
                else collapseToLevel(index);
              }}
              className="p-1 rounded hover:bg-gray-100 text-gray-400"
            >
              <ChevronDown size={14} />
            </button>
            <span className="uppercase tracking-wide">{dim}</span>
            {index === 0 && (
              <button onClick={addRegion} className="p-1 rounded hover:bg-gray-100 text-gray-500">
                <Plus size={14} />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Меню уровня">
                  <MoreVertical size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px]">
                <DropdownMenuItem onClick={() => startRenameDim(index)}>
                  <Pencil className="mr-2" size={14} /> Переименовать
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => addDimLeft(index)}>
                  <ArrowLeft className="mr-2" size={14} /> Добавить слева
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addDimRight(index)}>
                  <ArrowRight className="mr-2" size={14} /> Добавить справа
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              ref={dimInputRef}
              value={dimDraft}
              onChange={(e) => setDimDraft(e.target.value)}
              className="h-8 w-44"
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRenameDim();
                if (e.key === 'Escape') cancelRenameDim();
              }}
            />
            <button className="p-1 rounded hover:bg-gray-100 text-gray-600" onClick={commitRenameDim}>
              <Check size={16} />
            </button>
            <button className="p-1 rounded hover:bg-gray-100 text-gray-600" onClick={cancelRenameDim}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderNode = (n: TreeNode) => {
    const p = pos.get(n.id);
    if (!p) return null;
    const left = LEFT_PAD + p.level * COL_W;
    const top = TOP_PAD + p.y * ROW_H;
    const fullNode = findNodeAndParent(forest, n.id).node;
    const canToggle = (fullNode?.children || []).length > 0;
    const isCollapsed = collapsed.has(n.id);
    const selected = selectedId === n.id;
    const highlight = isMatch(n.name);
    const editing = editingNodeId === n.id;

    return (
      <div
        key={n.id}
        ref={(el) => {
          nodeRefs.current[n.id] = el;
        }}
        className={`absolute ${dropTargetId === n.id ? 'ring-2 ring-yellow-500' : ''}`}
        style={{ left, top, width: 190, height: 36 }}
        onMouseEnter={() => showOverlayForNode(n.id)}
        onMouseLeave={scheduleHideOverlay}
      >
        <div
          className={`relative w-full h-full bg-white border rounded-md shadow-sm cursor-pointer ${selected ? 'border-yellow-500' : 'border-gray-200'} ${highlight ? 'ring-2 ring-yellow-300' : ''}`}
          onClick={() => {
            setSelectedId(n.id);
            setPanelOpen(true);
          }}
        >
          <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button className="p-0.5 rounded hover:bg-gray-100 text-gray-400" onPointerDown={(e) => startDrag(n.id, e)} onClick={(e) => e.stopPropagation()}>
              <GripVertical size={14} />
            </button>
            {canToggle ? (
              <button
                className="p-0.5 rounded hover:bg-gray-100 text-gray-500"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(n.id);
                }}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="inline-block w-[18px]" />
            )}
          </div>

          <div className="h-full flex items-center pl-12 pr-3">
            {!editing ? (
              <div className="truncate text-sm text-gray-800 w-full">{n.name}</div>
            ) : (
              <input
                ref={nodeInputRef}
                value={nodeDraft}
                onChange={(e) => setNodeDraft(e.target.value)}
                className="h-full w-full bg-transparent outline-none text-sm text-gray-800"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRenameNode();
                  if (e.key === 'Escape') cancelRenameNode();
                }}
                onBlur={commitRenameNode}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen bg-[#f7f7f7] flex flex-col">
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            const isGroupTab = tab === groupName;
            return (
              <div key={tab} className="flex items-center gap-1">
                <button onClick={() => setActiveTab(tab)} className={`text-sm pb-1 ${isActive ? 'border-b-2 border-yellow-500 font-medium' : 'text-gray-500'}`}>
                  {tab}
                </button>
                {isGroupTab && editingGroup && (
                  <div className="ml-2 flex items-center gap-1">
                    <Input
                      ref={groupInputRef}
                      value={groupDraft}
                      onChange={(e) => setGroupDraft(e.target.value)}
                      className="h-8 w-44"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRenameGroup();
                        if (e.key === 'Escape') cancelRenameGroup();
                      }}
                    />
                    <button className="p-1 rounded hover:bg-gray-100 text-gray-600" onClick={commitRenameGroup}><Check size={16} /></button>
                    <button className="p-1 rounded hover:bg-gray-100 text-gray-600" onClick={cancelRenameGroup}><X size={16} /></button>
                  </div>
                )}
                {isGroupTab && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={`p-1 rounded hover:bg-gray-100 ${isActive ? 'text-gray-700' : 'text-gray-400'}`} aria-label="Меню группы"><MoreVertical size={16} /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[220px]">
                      <DropdownMenuItem onClick={startRenameGroup}><Pencil className="mr-2" size={14} /> Переименовать</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onClick={() => {
                          setGroupName('Регион');
                          setActiveTab('Регион');
                          setDims(defaultDims);
                          setForest(initialForest);
                          setSelectedId(null);
                          setCollapsed(new Set());
                          setPanelOpen(false);
                          setOverlay(null);
                          setChangeLog([]);
                          addChange('Сброшены настройки группы (черновик)');
                        }}
                      >
                        <Trash2 className="mr-2" size={14} /> Сбросить черновик
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
        <Button className="bg-yellow-500 hover:bg-yellow-600 text-white rounded-md text-sm">Добавить группу аналитики</Button>
      </div>

      <div className="bg-white px-6 py-3 border-b">
        <div className="flex items-center gap-3">
          <Input placeholder="Найти элемент" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[360px]" />
          <Button onClick={applyChanges} disabled={!hasPendingChanges} className={`${hasPendingChanges ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-200'} text-white`}>
            Применить изменения
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="relative p-2 rounded hover:bg-gray-100 text-gray-500" aria-label="Журнал изменений" onClick={(e) => e.stopPropagation()}>
                <History size={18} />
                {hasPendingChanges && <span className="absolute -top-1 -right-1 text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500 text-white">{changeLog.length}</span>}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[460px]">
              <div className="px-3 py-2 text-sm font-medium text-gray-900">Журнал изменений</div>
              <div className="px-3 pb-2 text-xs text-gray-500">Здесь видно, какие правки накопились в черновике.</div>
              <DropdownMenuSeparator />
              {changeLog.length === 0 ? <div className="px-3 py-6 text-sm text-gray-500">Нет накопленных изменений.</div> : <div className="max-h-[340px] overflow-auto">{changeLog.slice().reverse().map((it) => <div key={it.id} className="px-3 py-2 border-b last:border-b-0"><div className="text-[11px] text-gray-400">{formatTime(it.at)}</div><div className="text-sm text-gray-800">{it.summary}</div></div>)}</div>}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-2 text-xs text-gray-500"><Info size={14} /><span>Изменения копятся в черновике.</span></div>
        </div>
        <div className="mt-1 text-[11px] text-gray-400">Применено: {committedGroupName} • {formatTime(committedAt)} {justApplied ? '• ✅ применено' : ''}</div>
      </div>

      <div className="bg-white border-b px-6 py-2">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(dims.length, 5)}, 1fr)` }}>
          {dims.map((d, i) => <div key={`${d}-${i}`} className="py-1">{renderDimHeader(d, i)}</div>)}
        </div>
      </div>

      <div className="relative flex-1 overflow-auto">
        <div className="relative" style={{ width: canvasW, height: canvasH }}>
          <svg className="absolute inset-0" width={canvasW} height={canvasH}>
            {edges.map(([from, to]) => {
              const a = pos.get(from);
              const b = pos.get(to);
              if (!a || !b) return null;
              const x1 = LEFT_PAD + a.level * COL_W + NODE_W;
              const y1 = TOP_PAD + a.y * ROW_H + NODE_H / 2;
              const x2 = LEFT_PAD + b.level * COL_W;
              const y2 = TOP_PAD + b.y * ROW_H + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              return <path key={`${from}-${to}`} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="#d1d5db" strokeWidth={1.2} />;
            })}
          </svg>
          {flatVisibleNodes.map(renderNode)}
        </div>

        <NodeActionsOverlay
          overlay={overlay}
          onAdd={addChildRight}
          onDelete={requestDeleteNode}
          onRequestClose={scheduleHideOverlay}
          onHoldOpen={clearOverlayTimer}
        />

        {drag && <div className="fixed z-[10000] pointer-events-none" style={{ left: drag.x + 12, top: drag.y + 12 }}><div className="px-3 py-2 bg-white border border-gray-200 rounded shadow-sm text-sm text-gray-700">Перемещение…</div></div>}

        {panelOpen && selectedNode && (
          <div className="fixed z-[9000] bg-white border-l shadow-xl" style={{ right: 0, top: 118, height: 'calc(100vh - 118px)', width: 520 }}>
            <div className="p-4 border-b flex items-start justify-between">
              <div><div className="text-lg font-medium text-gray-900">{selectedNode.name}</div><div className="text-xs text-gray-400 mt-0.5">{selectedDim}</div></div>
              <button className="p-2 rounded hover:bg-gray-100 text-gray-500" onClick={() => setPanelOpen(false)}><X size={18} /></button>
            </div>
            <div className="p-4 space-y-4 overflow-auto" style={{ height: 'calc(100% - 64px)' }}>
              <div><div className="text-xs text-gray-400 mb-2">Путь</div><div className="flex flex-wrap gap-1">{selectedPath.map((p) => <span key={p.id} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">{p.name}</span>)}</div></div>
              <div>
                <div className="flex items-center justify-between"><div className="text-xs text-gray-400">Участие в правилах</div><button className="text-xs text-blue-600 hover:underline" onClick={() => setRulesCollapsed((v) => !v)}>{rulesCollapsed ? 'Развернуть' : 'Свернуть'}</button></div>
                {!rulesCollapsed && (
                  <div className="mt-2 space-y-3">
                    <div className="border rounded bg-gray-50"><div className="px-3 py-2 flex items-center justify-between"><div className="text-xs text-gray-600">Документы</div><button className="text-xs text-blue-600 hover:underline" onClick={() => setDocsCollapsed((v) => !v)}>{docsCollapsed ? 'Развернуть' : 'Свернуть'}</button></div>{!docsCollapsed && <div className="px-3 pb-3 text-xs">Контент документов...</div>}</div>
                    <div className="border rounded bg-gray-50"><div className="px-3 py-2 flex items-center justify-between"><div className="text-xs text-gray-600">Платежи</div><button className="text-xs text-blue-600 hover:underline" onClick={() => setPaymentsCollapsed((v) => !v)}>{paymentsCollapsed ? 'Развернуть' : 'Свернуть'}</button></div>{!paymentsCollapsed && <div className="px-3 pb-3 text-xs">Правила по платежам (заглушка)</div>}</div>
                  </div>
                )}
              </div>
              <div className="pt-2"><button className="text-red-600 text-sm hover:underline" onClick={() => selectedId && requestDeleteNode(selectedId)}>Удалить</button></div>
            </div>
          </div>
        )}

        {deleteDialog.open && deleteDialog.nodeId && (
          <div className="fixed inset-0 z-[9500] bg-black/20 flex items-center justify-center p-6">
            <div className="bg-white rounded-lg shadow-xl border w-full max-w-[640px]">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">Удаление элемента</div>
                <button className="p-2 rounded hover:bg-gray-100" onClick={closeDeleteDialog}><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-sm text-gray-700">Удалить элемент <span className="font-medium">“{findNodeAndParent(forest, deleteDialog.nodeId).node?.name}”</span>?</div>
                {deleteHasChildren ? (
                  <div className="text-sm text-gray-600">У элемента есть дочерние. Выберите действие:</div>
                ) : (
                  <div className="text-sm text-gray-600">У элемента нет дочерних.</div>
                )}
                {deleteHasChildren && (
                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-2">Перевесить детей на</div>
                    <select className="w-full h-9 border rounded px-2 text-sm" value={reassignTargetId || ''} onChange={(e) => setReassignTargetId(e.target.value || null)}>
                      <option value="">— выбрать элемент —</option>
                      {reassignOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="p-4 border-t flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={closeDeleteDialog}>Отмена</Button>
                {deleteHasChildren && <Button onClick={confirmReassignChildren} disabled={!reassignTargetId} className="bg-gray-800 hover:bg-gray-900 text-white">Перевесить детей и удалить</Button>}
                <Button onClick={confirmDeleteWithChildren} className="bg-red-600 hover:bg-red-700 text-white">Удалить</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
