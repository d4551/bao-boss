UPDATE baoboss.job
SET    state         = 'completed',
       "completedOn" = now(),
       output        = $2::jsonb
WHERE  id = $1::uuid
  AND  state = 'active'
RETURNING *;
