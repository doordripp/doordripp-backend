const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execPromise = util.promisify(exec);

// Get path to both frontend and backend repos based on typical structure
const backendRepoPath = path.resolve(__dirname, '../../');
const frontendRepoPath = path.resolve(__dirname, '../../../doordripp-frontend');

async function getCommitsForRepo(repoPath, repoName) {
  try {
    // Check if repo exists
    await execPromise('git rev-parse --is-inside-work-tree', { cwd: repoPath });

    // 1. Get all commits
    const { stdout: logOut } = await execPromise(
      'git log --all --format="%H|%cd|%an|%s|%D" --date=iso-strict -n 100',
      { cwd: repoPath }
    );
    
    // 2. Get main branch commits to know what is merged
    const { stdout: mainLogOut } = await execPromise(
      'git log main --format="%H" || git log master --format="%H" || echo ""',
      { cwd: repoPath }
    );
    
    const mainCommits = new Set(mainLogOut.split('\n').map(l => l.trim()).filter(Boolean));

    const lines = logOut.split('\n').filter(Boolean);
    const commits = lines.map(line => {
      const parts = line.split('|');
      const hash = parts[0] || '';
      const date = parts[1] || '';
      const author = parts[2] || 'Unknown';
      const message = parts[3] || '';
      const refs = parts[4] || '';
      
      // Try to determine branch from refs if possible, though git log --all shows all commits
      let branch = 'unknown';
      if (refs) {
        // e.g. HEAD -> main, origin/main, branch-name
        const refParts = refs.split(',').map(r => r.trim());
        const localBranches = refParts.filter(r => !r.includes('origin/') && !r.includes('HEAD'));
        if (localBranches.length > 0) {
          branch = localBranches[0];
        } else if (refParts.length > 0) {
          branch = refParts[0].replace('HEAD -> ', '');
        }
      }

      return {
        id: hash,
        repo: repoName,
        date,
        author,
        message,
        branch,
        refs,
        mergedToMain: mainCommits.has(hash)
      };
    });
    
    return commits;
  } catch (error) {
    console.error(`Error fetching commits for ${repoName}:`, error.message);
    return [];
  }
}

exports.getSystemLogs = async (req, res) => {
  try {
    const backendCommits = await getCommitsForRepo(backendRepoPath, 'Backend');
    const frontendCommits = await getCommitsForRepo(frontendRepoPath, 'Frontend');

    // Combine and sort by date descending
    const allCommits = [...backendCommits, ...frontendCommits].sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });

    res.json({
      success: true,
      logs: allCommits.slice(0, 100)
    });
  } catch (error) {
    console.error("Error fetching system logs:", error);
    res.status(500).json({ success: false, message: 'Failed to fetch system logs' });
  }
};
