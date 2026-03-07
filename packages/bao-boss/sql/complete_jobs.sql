UPDATE baoboss.job
SET    state        = 'completed',
       completed_on = now(),
       output       = $2::jsonb
WHERE  id = $1
  AND  state = 'active'
RETURNING *;
