import React from 'react';
import {
  AlertCircle,
  BookOpen,
  CalendarPlus,
  CheckSquare,
  Clock,
  FileCheck2,
  HelpCircle,
  Layers,
  Play,
  Repeat,
} from 'lucide-react';
import { ListGroup, ListRow, Sheet } from './ui';

export type QuickActionKind =
  | 'startSession'
  | 'logSession'
  | 'addTask'
  | 'addHabit'
  | 'addChapter'
  | 'logMock'
  | 'addMistake'
  | 'addDoubt'
  | 'logPyq'
  | 'addDDay';

export interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: QuickActionKind) => void;
}

const ACTIONS: Array<{
  id: QuickActionKind;
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  {
    id: 'startSession',
    title: 'Start session',
    subtitle: 'Open Focus timer for Pomodoro, Countdown, or Mock',
    Icon: Play,
  },
  {
    id: 'logSession',
    title: 'Log session',
    subtitle: 'Record study hours manually for today or past days',
    Icon: Clock,
  },
  {
    id: 'addTask',
    title: 'Add task',
    subtitle: 'Add a one-off study task to Today',
    Icon: CheckSquare,
  },
  {
    id: 'addHabit',
    title: 'Add habit',
    subtitle: 'Create a daily, weekday, or auto-timer habit',
    Icon: Repeat,
  },
  {
    id: 'addChapter',
    title: 'Add chapter',
    subtitle: 'Add syllabus chapters in Prep',
    Icon: BookOpen,
  },
  {
    id: 'logMock',
    title: 'Log mock',
    subtitle: 'Record a NEET mock test score and mistakes',
    Icon: FileCheck2,
  },
  {
    id: 'addMistake',
    title: 'Add mistake',
    subtitle: 'Capture a question error for review',
    Icon: AlertCircle,
  },
  {
    id: 'addDoubt',
    title: 'Add doubt',
    subtitle: 'Save an unresolved topic to your doubt queue',
    Icon: HelpCircle,
  },
  {
    id: 'logPyq',
    title: 'Log PYQ',
    subtitle: 'Track past-year question accuracy by chapter',
    Icon: Layers,
  },
  {
    id: 'addDDay',
    title: 'Add D-Day',
    subtitle: 'Set an exam or syllabus milestone countdown',
    Icon: CalendarPlus,
  },
];

export const QuickActionsSheet: React.FC<QuickActionsSheetProps> = ({
  open,
  onClose,
  onAction,
}) => (
  <Sheet
    open={open}
    onClose={onClose}
    title="Quick actions"
    subtitle="Jump straight to any study or prep workflow"
  >
    <ListGroup>
      {ACTIONS.map(({ id, title, subtitle, Icon }) => (
        <ListRow
          key={id}
          title={title}
          subtitle={subtitle}
          leading={<Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
          chevron
          onClick={() => {
            onClose();
            onAction(id);
          }}
        />
      ))}
    </ListGroup>
  </Sheet>
);
