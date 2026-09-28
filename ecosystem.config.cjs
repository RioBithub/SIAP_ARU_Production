module.exports = {
  apps: [
    {
      name: "siap-aru",
      cwd: "/opt/apps/siap-aru",
      script: "./node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3200",

      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production"
      },

      autorestart: true,
      watch: false,
      restart_delay: 3000,
      max_memory_restart: "700M",
      time: true
    }
  ]
};
