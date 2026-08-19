import os
import sys

import pendulum

from airflow import DAG
from airflow.providers.standard.operators.bash import BashOperator
from airflow.providers.standard.operators.python import PythonOperator
from airflow.sdk import Variable

tmp = Variable.get("tmp")
repo_dir = os.path.join(tmp, "thi")
REPO_URL = "https://github.com/klandermans/thi.git"

default_args = {
    "owner": "dairy-campus",
    "retries": 1,
}

secrets = Variable.get("thi_secrets", deserialize_json=True)

# Passed as a short-lived request header rather than embedded in the remote URL, so it's
# never written to .git/config and never echoed back by git's own error messages on failure
# (git redacts extraheader values from its output; it does not redact credentials in URLs).
GIT_AUTH_ARGS = """
GIT_AUTH_ARGS=()
if [ -n "${GH_PAT:-}" ]; then
  GIT_AUTH_ARGS=(-c "http.extraheader=AUTHORIZATION: bearer ${GH_PAT}")
fi
"""


def _run_generate_data(repo_dir, api_key):
    os.chdir(repo_dir)
    os.environ["METEOSERVER_API_KEY"] = api_key
    sys.path.insert(0, repo_dir)
    import generate_data

    generate_data.main()


def _run_send_notifications(repo_dir, env_vars):
    os.chdir(repo_dir)
    os.environ.update(env_vars)
    sys.path.insert(0, repo_dir)
    import send_notification

    send_notification.main()


with DAG(
    dag_id="thi_updater",
    description="get weather forecasts, pushing data to the site and sending notifications on update",
    start_date=pendulum.datetime(2026, 1, 1, tz="Europe/Amsterdam"),
    schedule="41 8,11,14 * * *",
    catchup=False,
    default_args=default_args,
    tags=["thi", "dairycampus"],
    max_active_runs=1,
) as dag:

    git_pull = BashOperator(
        task_id="git_pull",
        env={"GH_PAT": secrets.get("GH_PAT", "")},
        bash_command=f"""
set -euo pipefail
{GIT_AUTH_ARGS}
if [ ! -d "{repo_dir}/.git" ]; then
  git clone "{REPO_URL}" "{repo_dir}"
fi
cd "{repo_dir}"
git "${{GIT_AUTH_ARGS[@]}}" pull --ff-only
""",
    )

    generate_data = PythonOperator(
        task_id="generate_data",
        python_callable=_run_generate_data,
        op_kwargs={"repo_dir": repo_dir, "api_key": secrets["METEOSERVER_API_KEY"]},
    )

    commit_and_push = BashOperator(
        task_id="commit_and_push",
        env={"GH_PAT": secrets.get("GH_PAT", "")},
        bash_command=f"""
set -uo pipefail
cd "{repo_dir}
git config user.email "airflow@dairycampus.local"
git config user.name "THI Airflow"
{GIT_AUTH_ARGS}
git add docs/data/*.json
git diff --quiet && git diff --staged --quiet || (git commit -m "update weather data [skip ci]" && git "${{GIT_AUTH_ARGS[@]}}" push origin HEAD:main)
""",
    )

    send_notifications = PythonOperator(
        task_id="send_notifications",
        python_callable=_run_send_notifications,
        op_kwargs={
            "repo_dir": repo_dir,
            "env_vars": {
                "SUPABASE_URL": secrets["SUPABASE_URL"],
                "SUPABASE_KEY": secrets["SUPABASE_KEY"],
                "VAPID_PUBLIC_KEY": secrets["VAPID_PUBLIC_KEY"],
                "VAPID_PRIVATE_KEY": secrets["VAPID_PRIVATE_KEY"],
                "VAPID_SUBJECT": secrets["VAPID_SUBJECT"],
            },
        },
    )

    cleanup = BashOperator(
        task_id="cleanup",
        bash_command=f"""
set -euo pipefail
rm -rf "{repo_dir}"
""",
    )

    git_pull >> generate_data >> commit_and_push >> send_notifications >> cleanup
