export type Event = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  location: string | null;
};
