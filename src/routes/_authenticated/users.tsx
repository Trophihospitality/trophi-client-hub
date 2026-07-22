import { createFileRoute, redirect, Outlet } from '@tanstack/react-router';
import { useAuth } from '@/store/userStore';

export const Route = createFileRoute('/_authenticated/users')({
  component: UsersLayout,
});

function UsersLayout() {
  const { profile } = useAuth();
  if (profile && profile.role !== 'admin') {
    throw redirect({ to: '/crm' });
  }
  return <Outlet />;
}
