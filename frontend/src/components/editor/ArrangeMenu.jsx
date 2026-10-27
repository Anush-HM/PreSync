import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, BringToFront, ChevronDown, ChevronUp, Group,
  Layers, SendToBack, Ungroup
} from 'lucide-react';
import Menu from '../ui/Menu.jsx';

// Arrange: stacking order, alignment, distribution and grouping for the
// selected elements. One element aligns to the slide; several align to
// each other.
function ArrangeMenu({ selectedBlocks, a }) {
  const n = selectedBlocks.length;
  const grouped = selectedBlocks.some((b) => b.groupId);
  const toSlide = n === 1 ? ' (to slide)' : '';
  const items = [
    { label: 'Bring to front', icon: BringToFront, onSelect: () => a.restack('front') },
    { label: 'Bring forward', icon: ChevronUp, onSelect: () => a.restack('forward') },
    { label: 'Send backward', icon: ChevronDown, onSelect: () => a.restack('backward') },
    { label: 'Send to back', icon: SendToBack, onSelect: () => a.restack('back') },
    'separator',
    { label: `Align left${toSlide}`, icon: AlignStartVertical, onSelect: () => a.align('left') },
    { label: `Align centre${toSlide}`, icon: AlignCenterVertical, onSelect: () => a.align('centre') },
    { label: `Align right${toSlide}`, icon: AlignEndVertical, onSelect: () => a.align('right') },
    { label: `Align top${toSlide}`, icon: AlignStartHorizontal, onSelect: () => a.align('top') },
    { label: `Align middle${toSlide}`, icon: AlignCenterHorizontal, onSelect: () => a.align('middle') },
    { label: `Align bottom${toSlide}`, icon: AlignEndHorizontal, onSelect: () => a.align('bottom') },
    'separator',
    { label: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter, onSelect: () => a.distribute('horizontal'), disabled: n < 3 },
    { label: 'Distribute vertically', icon: AlignVerticalDistributeCenter, onSelect: () => a.distribute('vertical'), disabled: n < 3 },
    'separator',
    { label: 'Group', icon: Group, onSelect: a.group, disabled: n < 2 },
    { label: 'Ungroup', icon: Ungroup, onSelect: a.ungroup, disabled: !grouped }
  ];
  return <Menu label="Arrange" icon={Layers} text="Arrange" items={items} triggerClassName="btn btn-ghost btn-sm" />;
}

export default ArrangeMenu;
