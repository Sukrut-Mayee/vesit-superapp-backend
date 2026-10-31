const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /admin/stats
 * Returns college-scoped system overview counts.
 */
router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const collegeId = req.user.collegeId;

    // Parallel fetch for all counts
    const [usersRes, resourcesRes, borrowsRes, approvalsRes] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('college_id', collegeId),
      supabase.from('resources').select('*', { count: 'exact', head: true }).eq('college_id', collegeId),
      supabase.from('borrow_requests').select('*', { count: 'exact', head: true }).eq('college_id', collegeId).in('status', ['APPROVED', 'ACTIVE']),
      supabase.from('borrow_requests').select('*', { count: 'exact', head: true }).eq('college_id', collegeId).eq('status', 'REQUESTED')
    ]);

    if (usersRes.error) throw usersRes.error;
    if (resourcesRes.error) throw resourcesRes.error;
    if (borrowsRes.error) throw borrowsRes.error;
    if (approvalsRes.error) throw approvalsRes.error;

    res.json({
      stats: {
        totalUsers: usersRes.count || 0,
        totalResources: resourcesRes.count || 0,
        activeBorrows: borrowsRes.count || 0,
        pendingApprovals: approvalsRes.count || 0
      }
    });
  } catch (err) {
    console.error('get admin stats error', err);
    res.status(500).json({ error: 'Could not fetch system overview' });
  }
});

module.exports = router;