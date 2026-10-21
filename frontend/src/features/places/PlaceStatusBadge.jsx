import { Badge } from '../../components/Badge.jsx';

const STATUS = {
  PENDING: { tone: 'warning', label: 'Pending review' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
};

// Moderation status as text (colour only reinforces it). `hideApproved` for public views.
export function PlaceStatusBadge({ status, hideApproved = false }) {
  if (hideApproved && status === 'APPROVED') return null;
  const { tone, label } = STATUS[status] ?? STATUS.PENDING;
  return <Badge tone={tone}>{label}</Badge>;
}
