DELETE FROM `documents`
WHERE `source_id` = 'source:academy'
  AND `name` = 'blackboard-1-to-many-File'
  AND `mime_type` = 'text/html'
  AND `source_url` = 'https://academy.am.lu/mod/resource/view.php';
